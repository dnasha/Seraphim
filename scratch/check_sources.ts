import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkSources() {
    const { data, error } = await supabase
        .from('events')
        .select('sources, credibility_tier')
        .not('sources', 'is', null)
        .limit(10);
    
    if (error) {
        console.error('Error:', error.message);
        return;
    }
    
    data.forEach((row, i) => {
        console.log(`Row ${i} Master Tier: ${row.credibility_tier}`);
        console.log(`Row ${i} Sources:`, JSON.stringify(row.sources).slice(0, 200));
    });
}

checkSources();
