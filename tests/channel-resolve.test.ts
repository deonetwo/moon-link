import assert from 'node:assert';
import { AppConfig, loadConfig } from '../src/config.js';
import { initDiscordClient, resolveChannel } from '../src/discord.js';

async function runChannelResolutionTests() {
  console.log('\n--- Running Channel Resolution Tests ---\n');

  const config = loadConfig();
  if (!config.discordToken) {
    console.log('⚠️ Skipping live Discord tests (no token).');
    return;
  }

  await initDiscordClient(config);

  // Test 1: Resolve by numeric snowflake ID
  console.log('Test 1: Resolve by numeric snowflake ID');
  const ch1 = await resolveChannel('1550706214629806221');
  assert.strictEqual(ch1.name, 'arsip-besar');
  console.log('✅ Resolved channel by ID:', ch1.name, ch1.id);

  // Test 2: Resolve by exact name
  console.log('\nTest 2: Resolve by exact channel name');
  const ch2 = await resolveChannel('arsip-besar');
  assert.strictEqual(ch2.id, '1550706214629806221');
  console.log('✅ Resolved channel by exact name:', ch2.name);

  // Test 3: Resolve by name with leading '#'
  console.log('\nTest 3: Resolve by name with leading "#"');
  const ch3 = await resolveChannel('#arsip-besar');
  assert.strictEqual(ch3.id, '1550706214629806221');
  console.log('✅ Resolved channel by #name:', ch3.name);

  // Test 4: Resolve by spaced name (hyphen conversion)
  console.log('\nTest 4: Resolve by spaced name');
  const ch4 = await resolveChannel('arsip besar');
  assert.strictEqual(ch4.id, '1550706214629806221');
  console.log('✅ Resolved channel by spaced name:', ch4.name);

  // Test 5: Resolve by Discord mention syntax
  console.log('\nTest 5: Resolve by Discord mention syntax <#...>');
  const ch5 = await resolveChannel('<#1550706214629806221>');
  assert.strictEqual(ch5.id, '1550706214629806221');
  console.log('✅ Resolved channel by mention syntax:', ch5.name);

  // Test 6: Resolve newly created mainframe-channel by name
  console.log('\nTest 6: Resolve "mainframe-channel" by name');
  const ch6 = await resolveChannel('mainframe-channel');
  assert.strictEqual(ch6.name, 'mainframe-channel');
  console.log('✅ Resolved newly created channel:', ch6.name, `(${ch6.id})`);

  // Test 7: Helpful error message when channel is not found
  console.log('\nTest 7: Missing channel error message');
  let threw = false;
  try {
    await resolveChannel('non-existent-channel-xyz');
  } catch (err: any) {
    threw = true;
    assert.ok(err.message.includes('not found in server'), 'Should indicate channel was not found');
    assert.ok(err.message.includes('Available text channels:'), 'Should list available text channels');
    assert.ok(err.message.includes('#mainframe-channel'), 'Available channels should list #mainframe-channel');
    console.log('✅ Received expected descriptive error:\n   ', err.message);
  }
  assert.strictEqual(threw, true, 'Should have thrown for nonexistent channel');

  console.log('\n=====================================================');
  console.log('🎉 ALL CHANNEL RESOLUTION TESTS PASSED (7/7)');
  console.log('=====================================================\n');
  process.exit(0);
}

runChannelResolutionTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
