/*
Semantic vectorization utilities for the Seraphim scraper.

Uses @huggingface/transformers to run the all-MiniLM-L6-v2 ONNX model
locally (CPU/WASM) with zero external API costs.

Design:
  - Singleton pipeline: The model is loaded once and reused across the
    entire scraper run (~22MB quantized weights).
  - Batch embedding: All texts are embedded in a single pipeline call
    to maximize throughput and minimize WASM overhead.
  - In-memory similarity: Cosine similarity is computed locally using
    simple dot products on 384-dim vectors, avoiding per-item DB round
    trips entirely.
*/

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Force local cache directory for CI/CD stability and reliable caching
env.cacheDir = './.cache';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/* Similarity thresholds */
export const SIMILARITY_THRESHOLD_STRICT = 0.85; // Merge regardless of distance
export const SIMILARITY_THRESHOLD_PLACE_ANCHORED = 0.75; // Merge if exact location name matches
export const SIMILARITY_THRESHOLD_PROXIMITY = 0.60; // Merge if within distance
export const MAX_MERGE_DISTANCE_KM = 50;

/* Singleton pipeline instance, loaded lazily on first call */
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

/*
Generates normalized 384-dim embeddings for an array of texts.
Returns one embedding per input text in the same order.
*/
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const pipe = await getPipeline();
    const output = await pipe(texts, { pooling: 'mean', normalize: true });

    /* output.tolist() returns number[][] with shape [texts.length, EMBEDDING_DIM] */
    const embeddings: number[][] = output.tolist();

    /* Sanity check dimensions */
    for (const emb of embeddings) {
        if (emb.length !== EMBEDDING_DIM) {
            throw new Error(`[vectorize] Unexpected embedding dimension: ${emb.length}, expected ${EMBEDDING_DIM}`);
        }
    }

    return embeddings;
}

/* Convenience wrapper for a single text */
export async function generateEmbedding(text: string): Promise<number[]> {
    const [embedding] = await generateEmbeddings([text]);
    return embedding;
}

/*
Computes cosine similarity between two normalized vectors.
Since both vectors are L2-normalized, cosine similarity = dot product.
This is O(384) per comparison — trivially fast for thousands of candidates.
*/
export function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}

/*
Calculates Haversine distance between two points in kilometers.
Used to gate semantic merges (e.g., "protest in London" vs "protest in Paris").
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

/*
Builds the text to embed from a news item.
Concatenates title + description for richer semantic signal.
Titles alone are too short for reliable similarity.
*/
export function buildEmbeddingText(title: string, description?: string | null): string {
    const parts = [title];
    if (description) {
        /* Truncate description to ~200 chars to keep embedding focused on the core story */
        parts.push(description.slice(0, 200));
    }
    return parts.join('. ');
}
