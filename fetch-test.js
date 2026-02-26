async function test() {
    const res = await fetch('http://localhost:3000/api/news?refresh=true');
    const d = await res.json();
    const mapped = d.items.filter(x => x.latitude);
    const unmapped = d.items.filter(x => !x.latitude);
    console.log(`\nMapped: ${mapped.length} / ${d.items.length} (${Math.round(mapped.length / d.items.length * 100)}%)\n`);
    console.log('--- MAPPED (first 15) ---');
    mapped.slice(0, 15).forEach(x => console.log(`  [${x.locationName}] ${x.title.substring(0, 70)}`));
    console.log('\n--- UNMAPPED (first 15) ---');
    unmapped.slice(0, 15).forEach(x => console.log(`  ${x.title.substring(0, 70)}`));
}
test();
