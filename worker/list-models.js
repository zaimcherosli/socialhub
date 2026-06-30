const apiKey = "AQ.Ab8RN6LmnRrFmnf2yGecUEX5NKskMfkEAdx1DoDxpVq-6Mb_QQ";

fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
.then(async res => {
    console.log("Status:", res.status);
    const data = await res.json();
    if (data.models) {
        const generateModels = data.models
            .filter(m => m.supportedGenerationMethods.includes("generateContent"))
            .map(m => m.name);
        console.log("Available generateContent models:", generateModels);
    } else {
        console.log("Response:", JSON.stringify(data, null, 2));
    }
})
.catch(console.error);
