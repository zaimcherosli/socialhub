const apiKey = "AQ.Ab8RN6LmnRrFmnf2yGecUEX5NKskMfkEAdx1DoDxpVq-6Mb_QQ";
const models = [
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-1.5-pro",
  "gemini-2.0-pro",
  "gemini-2.5-pro"
];

async function run() {
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Say Hello" }] }] })
      });
      const data = await res.json();
      console.log(`Model: ${model}`);
      console.log(`  Status: ${res.status}`);
      if (res.status === 200) {
        console.log(`  Success!`);
      } else {
        console.log(`  Error: ${data.error ? data.error.message.substring(0, 150) : JSON.stringify(data)}`);
      }
    } catch (e) {
      console.log(`Model: ${model} failed: ${e.message}`);
    }
  }
}

run();
