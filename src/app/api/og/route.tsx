import { ImageResponse } from 'next/og';
import { supabase } from '@/lib/core/supabase';

export const runtime = 'edge';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const eventId = searchParams.get('eventId');

        if (!eventId) {
            return new Response('Missing eventId', { status: 400 });
        }

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(eventId)) {
            return new Response('Invalid UUID format', { status: 400 });
        }

        const { data: event } = await supabase
            .from('events')
            .select('title, description, source, location_name, published_at, credibility_tier')
            .eq('id', eventId)
            .single();

        if (!event) {
            return new Response('Event not found', { status: 404 });
        }

        // Parse credibility labels & colors matching Seraphim design standards
        let credLabel = 'Unverified';
        let credColor = '#94a3b8'; // Slate
        if (event.credibility_tier === 1) {
            credLabel = 'Verified';
            credColor = '#38bdf8'; // Sky blue
        } else if (event.credibility_tier === 2) {
            credLabel = 'Credible';
            credColor = '#fbbf24'; // Amber
        }

        // Format Date
        const dateStr = event.published_at 
            ? new Date(event.published_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'UTC'
            }) + ' UTC'
            : '';

        return new ImageResponse(
            (
                <div
                    style={{
                        height: '100%',
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        backgroundColor: '#0b0f19',
                        backgroundImage: 'radial-gradient(circle at 50% 50%, #1e1b4b 0%, #0b0f19 100%)',
                        padding: '60px 80px',
                        color: 'white',
                        fontFamily: 'sans-serif',
                        border: '8px solid #312e81',
                        boxSizing: 'border-box',
                    }}
                >
                    {/* Header Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '4px', color: '#6366f1' }}>
                                SERAPHIM
                            </span>
                            <span style={{ 
                                fontSize: '16px', 
                                fontWeight: 600, 
                                color: '#475569', 
                                letterSpacing: '2px', 
                                marginLeft: '8px', 
                                borderLeft: '2px solid #334155', 
                                paddingLeft: '12px',
                                display: 'flex'
                            }}>
                                OSINT INTELLIGENCE
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '6px 14px', borderRadius: '6px' }}>
                            <span style={{ fontSize: '14px', fontWeight: 700, color: '#818cf8', letterSpacing: '1px', textTransform: 'uppercase' }}>
                                LIVE AGGREGATOR
                            </span>
                        </div>
                    </div>

                    {/* Middle Section */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', margin: '40px 0' }}>
                        {/* Meta Tags (Source & Credibility) */}
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            {event.source && (
                                <span style={{
                                    fontSize: '14px',
                                    fontWeight: 700,
                                    backgroundColor: '#4f46e5',
                                    color: 'white',
                                    padding: '4px 10px',
                                    borderRadius: '4px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '1px'
                                }}>
                                    {event.source}
                                </span>
                            )}
                            <span style={{
                                fontSize: '14px',
                                fontWeight: 700,
                                color: credColor,
                                border: `1px solid ${credColor}`,
                                padding: '3px 8px',
                                borderRadius: '4px',
                                textTransform: 'uppercase',
                                letterSpacing: '1px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: credColor, display: 'flex' }}></span>
                                {credLabel}
                            </span>
                        </div>

                        {/* Title */}
                        <div style={{ 
                            fontSize: '44px', 
                            fontWeight: 800, 
                            lineHeight: 1.25, 
                            color: '#f8fafc',
                            maxHeight: '170px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: 'flex'
                        }}>
                            {event.title}
                        </div>

                        {/* Snippet / Description */}
                        {event.description && (
                            <div style={{ 
                                fontSize: '20px', 
                                color: '#94a3b8', 
                                lineHeight: 1.5,
                                maxHeight: '90px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                display: 'flex'
                            }}>
                                {event.description}
                            </div>
                        )}
                    </div>

                    {/* Footer Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', borderTop: '2px solid #1e293b', paddingTop: '24px' }}>
                        {/* Location */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="#f43f5e" style={{ marginRight: '4px' }}>
                                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                            </svg>
                            <span style={{ fontSize: '18px', fontWeight: 600, color: '#cbd5e1' }}>
                                {event.location_name || 'Global Intelligence'}
                            </span>
                        </div>

                        {/* Date */}
                        <div style={{ fontSize: '16px', fontWeight: 500, color: '#64748b' }}>
                            {dateStr}
                        </div>
                    </div>
                </div>
            ),
            {
                width: 1200,
                height: 630,
            }
        );
    } catch (e) {
        const error = e as Error;
        console.error('Error generating OG image:', error);
        return new Response(`Failed to generate image: ${error.message}`, { status: 500 });
    }
}
