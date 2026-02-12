import { Router } from "express";
import axios from "axios";
import { generate } from "./openai";
import { authMiddleware } from "./middleware";

const router = Router();

interface JiraCreateIssueResponse {
  id: string;
  key: string;
  self: string;
}


/* ===============================
   ENV CONFIG
================================ */

const JIRA_BASE = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_BASE || !JIRA_EMAIL || !JIRA_TOKEN) {
  console.warn("⚠ Jira environment variables missing");
}

const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");

/* ===============================
   ANALYZE (AI GENERATION)
================================ */

router.post("/analyze", authMiddleware, async (req, res) => {
  try {
    const { title, description, type, action } = req.body;

    if (!title || !action) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const prompt = buildPrompt(title, description, type, action);
    const output = await generate(prompt);

    res.json({ output });
  } catch (err) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: "AI failure" });
  }
});

/* ===============================
   CREATE TASKS
================================ */

router.post("/create-tasks", authMiddleware, async (req, res) => {
  try {
    const { issueKey, tasks } = req.body;

    if (!issueKey || !Array.isArray(tasks)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const projectKey = issueKey.split("-")[0];
    const created: string[] = [];

    for (const task of tasks) {
      const response = await axios.post<JiraCreateIssueResponse>(
        `${JIRA_BASE}/rest/api/3/issue`,
        {
          fields: {
            project: { key: projectKey },
            summary: task.title,
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: task.description }]
                }
              ]
            },
            issuetype: { name: "Task" }
          }
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
            "Content-Type": "application/json"
          }
        }
      );

      const newIssueKey = response.data.key;
      created.push(newIssueKey);

      /* LINK TO PARENT */
      await axios.post(
        `${JIRA_BASE}/rest/api/3/issueLink`,
        {
          type: { name: "Relates" },
          inwardIssue: { key: newIssueKey },
          outwardIssue: { key: issueKey }
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json"
          }
        }
      );
    }

    res.json({ success: true, created });
  } catch (err) {
    console.error("Create tasks error:", err);
    res.status(500).json({ error: "Task creation failed" });
  }
});

/* ===============================
   CREATE TEST CASES
================================ */

router.post("/create-testcases", authMiddleware, async (req, res) => {
  try {
    const { issueKey, testCases } = req.body;

    if (!issueKey || !Array.isArray(testCases)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const projectKey = issueKey.split("-")[0];

    for (const tc of testCases) {
      const response = await axios.post<JiraCreateIssueResponse>(
        `${JIRA_BASE}/rest/api/3/issue`,
        {
          fields: {
            project: { key: projectKey },
            summary: tc.title,
            issuetype: { name: "Test" } // Xray / Zephyr if installed
          }
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
            "Content-Type": "application/json"
          }
        }
      );

      const newIssueKey = response.data.key;

      await axios.post(
        `${JIRA_BASE}/rest/api/3/issueLink`,
        {
          type: { name: "Relates" },
          inwardIssue: { key: newIssueKey },
          outwardIssue: { key: issueKey }
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json"
          }
        }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Create test cases error:", err);
    res.status(500).json({ error: "Test case creation failed" });
  }
});

/* ===============================
   PROMPT BUILDER
================================ */

function buildPrompt(
  title: string,
  desc: string,
  type: string,
  action: string
) {
  switch (action) {
    case "tasks":
      return `
Break this Jira ${type} into implementation tasks.

Rules:
Return ONLY valid JSON:
{
  "tasks": [
    { "title": "", "description": "" }
  ]
}

Title: ${title}
Description: ${desc}
`;

    case "testcases":
      return `
Generate Jira test cases.

Return ONLY JSON:
{
  "testCases": [
    {
      "title": "",
      "steps": [{ "action": "", "expected": "" }]
    }
  ]
}

Title: ${title}
`;

    case "criteria":
      return `Generate acceptance criteria for Jira Story: ${title}`;

    case "description":
      return `Write a professional Jira description for ${type}: ${title}`;

    case "bug":
      return `Summarize this Jira bug clearly: ${desc}`;

    default:
      return title;
  }
}

export default router;
