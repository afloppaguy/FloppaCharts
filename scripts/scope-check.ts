// Checks that each sign-in sees only its own keys, settings and idea chats.
// Reads only; run with: npx tsx scripts/scope-check.ts
try {
  process.loadEnvFile(".env.local");
} catch {}

export {};

async function main() {
  const { ready, q } = await import("../src/lib/db");
  const { runAs } = await import("../src/lib/scope");
  const { getApiKey, getAiSettings, getChosenModel } = await import("../src/lib/ai");
  const { listChats } = await import("../src/lib/chat");
  await ready();
  for (const uid of [0, 1]) {
    await runAs(uid, async () => {
      const [key, settings, model, chats, keys, games] = await Promise.all([
        getApiKey(),
        getAiSettings(),
        getChosenModel(),
        listChats(),
        q("SELECT id FROM rbx_keys WHERE owner_id = ?", [uid]),
        q("SELECT universe_id FROM my_games WHERE owner_id = ?", [uid]),
      ]);
      console.log(`uid ${uid}: claude key ${key ? "set" : "none"}, model ${model}, settings ${JSON.stringify(settings)}, ${chats.length} chats, ${keys.length} roblox keys, ${games.length} games`);
    });
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
