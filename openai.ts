import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: process.env.AZURE_OPENAI_ENDPOINT,
  defaultQuery: { "api-version": "2024-02-15-preview" },
  defaultHeaders: {
    "api-key": process.env.AZURE_OPENAI_API_KEY
  }
});

export async function generate(prompt: string) {
  const deployment =
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
    process.env.AZURE_OPENAI_DEPLOYMENT;

  if (!deployment) {
    throw new Error("Missing AZURE_OPENAI_DEPLOYMENT_NAME");
  }

  try {
    const completion = await client.chat.completions.create({
      model: deployment,
      messages: [
        {
          role: "system",
          content:
            "You are an expert Agile software engineer and Jira documentation specialist. Return clean structured plain text. No markdown."
        },
        { role: "user", content: prompt }
      ]
    });

    return completion.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.error("OpenAI error:", err);
    throw err;
  }
}
