## What's new in 0.3.0

**🗺️ Execution map**
- After you solve a problem, **See execution map** shows what the engine actually did, next to the reference solution, with a one-line verdict.
- **PySpark:** stages, shuffles and narrow vs wide steps, planned as on big data. **SQL:** DuckDB's steps with real row counts and timing. **Python:** how often each line ran and how your code grows (O(n) vs O(n²)).
- Click any step to inspect it and see what fed into it. Click a row count to see the actual rows that passed through.

**🔑 Coaches**
- **Sign in instead of pasting a key:** with your Anthropic account, ChatGPT plan, or Google Cloud.
- The model list is always current: new models appear and retired ones disappear on their own, and a retired model you picked switches to its newest sibling.
- **New chat** clears a coach conversation and starts fresh.

**✨ Workspace**
- **Format** your code (Shift + Alt + F): black for Python and PySpark, and your engine's own SQL dialect.
- Results show **column names** for expected and actual output, and a bar with one segment per test.
- Hints reveal one at a time; problems are numbered in every list.
- SQL Server, Oracle and Snowflake syntax translate more reliably (recursive CTEs, `+` for joining text), and the coach steps in when the automatic translation can't.
- A **launch intro**: the logo draws itself in light when you open DataDojo (click to skip). DataDojo now starts in the dark theme; fresh icons, slimmer scrollbars, and no flicker when scrolling the home page.

## New in 0.2.1

- **Easier updates:** the Update button now shows what's new and downloads the right installer for your computer in one click.
- **Clearer microphone button** for spoken interview answers, with an obvious recording state.
- Sensei says **"Up late?"** after midnight instead of "Good morning".

## New in 0.2.0

**🎙️ Interview practice**
- Mock interviews and topic drills for **Data Engineer, AI Engineer, ML Engineer and Data Analyst**, at entry, mid or senior level (243 questions).
- **Answer out loud or type.** Your words appear as you speak, transcribed on your own computer; audio never leaves it.
- Sensei grades every answer point by point, shows what to improve and gives a suggested answer, plus pace and filler-word feedback. A report at the end, and a cheatsheet per role.

**🤖 AI System Design**
- A new section on production GenAI: RAG, fine-tuning, evals, observability, caching, feedback loops and guardrails.

**✨ Workspace**
- The solution popup now has Copy, an AI walkthrough, and "Ask the coach about it".
- Drag to resize the problem, editor, coach and results panels; close the results panel.
- The heatmap shows each month separately, with the date on hover. New Practice menu in the top bar.
- No more flicker when switching pages, and refresh keeps your place.

## How to update

- **Desktop app:** download the installer for your computer below and open it. On Mac, drag DataDojo into Applications and replace the old one.
- **Terminal install:** `uv tool upgrade datadojo`, then start `datadojo` again.

Your progress, settings and history are kept.
