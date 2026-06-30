const apiKey = "AQ.Ab8RN6LmnRrFmnf2yGecUEX5NKskMfkEAdx1DoDxpVq-6Mb_QQ";
const models = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-3-flash-preview",
  "gemini-flash-latest"
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
        console.log(`  Success! Text: ${data.candidates[0].content.parts[0].text.trim()}`);
      } else {
        console.log(`  Error: ${data.error ? data.error.message.substring(0, 150) : JSON.stringify(data)}`);
      }
    } catch (e) {
      console.log(`Model: ${model} failed with fetch error: ${e.message}`);
    }
  }
}

run();
