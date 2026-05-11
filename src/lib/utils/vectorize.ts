/**
 * Semantic vectorization utilities for the Seraphim scraper.
 * 
 * Uses @huggingface/transformers to run the all-MiniLM-L6-v2 ONNX model
 * locally (CPU/WASM) with zero external API costs.
 * 
 * Design:
 * 1. Singleton pipeline: The model is loaded once and reused across the
 *    entire scraper run (approximately 22MB quantized weights).
 * 2. Batch embedding: All texts are embedded in a single pipeline call
 *    to maximize throughput and minimize WASM overhead.
 * 3. In-memory similarity: Cosine similarity is computed locally using
 *    simple dot products on 384-dim vectors, avoiding per-item DB round trips.
 */

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Force local cache directory for CI/CD stability and reliable caching
env.cacheDir = './.cache';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Similarity thresholds for story clustering.
 * Strict: High confidence, merge regardless of distance.
 * Place Anchored: Moderate confidence, merge if locations match exactly.
 * Proximity: Lower confidence, merge only if geographically close.
 */
export const SIMILARITY_THRESHOLD_STRICT = 0.85;
export const SIMILARITY_THRESHOLD_PLACE_ANCHORED = 0.75;
export const SIMILARITY_THRESHOLD_PROXIMITY = 0.60;
export const MAX_MERGE_DISTANCE_KM = 50;

/**
 * Singleton pipeline instance, loaded lazily on the first call to generateEmbeddings.
 */
let _pipeline: FeatureExtractionPipeline | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!_pipeline) {
        console.log(`[vectorize] Loading model ${MODEL_ID}...`);
        const startMs = Date.now();
        _pipeline = await pipeline('feature-extraction', MODEL_ID);
        console.log(`[vectorize] Model loaded in ${((Date.now() - startMs) / 1000).toFixed(1)}s`);
    }
    return _pipeline;
}

/**
 * Generates normalized 384-dim embeddings for an array of texts.
 * Uses mean pooling and L2 normalization to prepare vectors for cosine similarity.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const pipe = await getPipeline();
    const output = await pipe(texts, { pooling: 'mean', normalize: true });

    const embeddings: number[][] = output.tolist();

    /**
     * Validate that the model returned the expected dimensions (384 for all-MiniLM-L6-v2).
     */
    for (const emb of embeddings) {
        if (emb.length !== EMBEDDING_DIM) {
            throw new Error(`[vectorize] Unexpected embedding dimension: ${emb.length}, expected ${EMBEDDING_DIM}`);
        }
    }

    return embeddings;
}

/**
 * Convenience wrapper for a single text embedding.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    const [embedding] = await generateEmbeddings([text]);
    return embedding;
}

/**
 * Computes cosine similarity between two normalized vectors.
 * Since both vectors are L2-normalized, cosine similarity is equivalent to the dot product.
 * This operation is O(384) and highly efficient for batch comparisons.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}

/**
 * Calculates the Haversine distance between two points in kilometers.
 * Used to gate semantic merges when stories are geographically distinct.
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Prepares the input text for embedding by concatenating the title and description.
 * Descriptions are truncated to maintain focus on the core semantic signal.
 */
export function buildEmbeddingText(title: string, description?: string | null): string {
    const parts = [title];
    if (description) {
        parts.push(description.slice(0, 200));
    }
    return parts.join('. ');
}
