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

interface JiraIssueResponse {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: any;
    issuetype: {
      name: string;
    };
  };
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
   FETCH ISSUE DETAILS
================================ */

router.get("/issue/:issueKey", authMiddleware, async (req, res) => {
  try {
    const { issueKey } = req.params;

    if (!issueKey) {
      return res.status(400).json({ error: "Missing issue key" });
    }

    const response = await axios.get<JiraIssueResponse>(
      `${JIRA_BASE}/rest/api/3/issue/${issueKey}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json"
        }
      }
    );

    const issue = response.data;

    res.json({
      key: issue.key,
      id: issue.id,
      type: issue.fields.issuetype.name,
      title: issue.fields.summary,
      description: issue.fields.description?.content?.[0]?.content?.[0]?.text || ""
    });

  } catch (err: any) {
    console.error("Fetch issue error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch issue" });
  }
});



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
   UPDATE DESCRIPTION
================================ */

router.post("/update-description", async (req, res) => {
  try {
    const { issueKey, description } = req.body;

    if (!issueKey || !description) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    await axios.put(
      `${JIRA_BASE}/rest/api/3/issue/${issueKey}`,
      {
        fields: {
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: description }]
              }
            ]
          }
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

    res.json({ success: true });
  } catch (err) {
    console.error("Update description error:", err);
    res.status(500).json({ error: "Update failed" });
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
      return `${type}: ${title} 

"""
You are an expert Agile Product Owner assistant responsible for generating high-quality, implementation-ready user stories.

Your task is to generate a complete user story based on the provided feature description.

You MUST strictly follow the structure and rules below.

# SER STORY FORMAT (MANDATORY) 
User Story must strictly follow this format:

### Description:
    As a **<user persona>**,
    **I want** <goal / capability>,
    **So that** <business value / benefit>.

### Acceptance Criteria:
    Guidelines for Acceptance Criteria:
    1. Ensure that each criterion is testable and measurable.
    2. Write criteria in the context of the user persona described in the problem.
    3. You MUST use EITHER:
        - Gherkin syntax (Given, When, Then) format for behavioral scenarios, OR
        - Clear, concise bullet points for testable outcomes.
    4. DO NOT use both Gherkin and bullet points together.
    5. Avoid generic statements such as:
        - Ensure TAD and TS are adhered
        - Delivered solution does not generate additional issues on servers and browser
    6. Additional Gherkin scenarios for other user personas can be listed separately if necessary.


### IMPORTANT INSTRUCTIONS:
    1. Expand the context clearly and professionally.
    2. Provide sufficient functional clarity for engineering implementation.
    3. Include constraints, scope boundaries, and relevant business context.
    4. Keep it structured and concise.
    5. Do NOT include acceptance criteria inside the description.
    6. Do NOT include implementation-level technical steps unless explicitly required.

### QUALITY CONSTRAINTS:
    1. The story must be small enough to fit within a single sprint of 10 days (2 work weeks).
    2. Acceptance criteria must remove ambiguity.
    3. Avoid vague terms such as fast, user-friendly, optimized, etc.
    4. Do not assume hidden requirements.
    5. If details are missing, make reasonable assumptions and reflect them clearly in the acceptance criteria.
    6. Output must be clean and ready for direct use in Jira, Azure DevOps, or similar tools.

### Follow the given example format strictly:

Example Input:
  Title: "Finalize Output Schema and Spec Kit Execution Framework for FAB Extraction Agents"
  Issue Type: Story
Example Output:
  ### Description:
    As a **Developer**,
    **I want** to finalize the output JSON schema for Loan and Real Estate agents after FAB-driven extraction,
    **So that** the Spec Kit prompt lifecycle executes as a single cohesive flow and the system produces consistent, deterministic outputs with reliable document handling.

  ### Acceptance Criteria:
  Scenario 1: Output JSON schema is finalized and enforced
      Given the FAB agent completes execution and extraction is successful
      When the agent produces its final response
      Then the response strictly conforms to the approved output JSON schema
      And the schema remains consistent across both Loan and Real Estate agent types
      And no undocumented or extra fields are present

    Scenario 2: Spec Kit prompt framework executes as a unified lifecycle
      Given a valid input document or payload
      When the Spec Kit lifecycle runs using the Constitution, Specify, Plan, Task, and Implement prompts
      Then each prompt executes in the defined order
      And responsibilities remain clearly separated across prompts
      And code generation completes successfully
"""

      
      `;

    case "bug":
      return `Summarize this Jira bug clearly: ${desc}`;

    default:
      return title;
  }
}

export default router;
