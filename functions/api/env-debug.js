export async function onRequest(context) {
  const keys = Object.keys(context.env).filter(k => !k.startsWith('__'));
  return Response.json({
    keys,
    hasDB: !!context.env.DB,
    hasStorage: !!context.env.STORAGE,
    hasGemini: !!context.env.GEMINI_API_KEY,
    hasDeepSeek: !!context.env.DEEPSEEK_API_KEY,
    geminiType: typeof context.env.GEMINI_API_KEY,
    deepseekType: typeof context.env.DEEPSEEK_API_KEY,
  });
}
