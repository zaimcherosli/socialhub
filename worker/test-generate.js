const apiKey = "AQ.Ab8RN6LmnRrFmnf2yGecUEX5NKskMfkEAdx1DoDxpVq-6Mb_QQ";
const model = "gemini-2.0-flash";

const prompt = "Say Hello World";

fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify({
        contents: [{
            parts: [{ text: prompt }]
        }]
    })
})
.then(async res => {
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Response:", JSON.stringify(data, null, 2));
})
.catch(console.error);
