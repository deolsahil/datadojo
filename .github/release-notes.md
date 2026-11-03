## What's new in 0.3.5

- **Update from inside the app.** A notification tells you when a new version is out. Click Update and DataDojo downloads it in the background with a progress bar (the coaches race to the finish line while you wait), then restarts when you're ready. Choose Later and it installs the next time you quit.
- **Switch your coach model in one click.** Click the model label on the home page or next to a coach to pick another model from your plan or key: OpenAI, Claude, Gemini or a local model.
- *Updating from 0.3.4 or earlier:* download this version once from the release page; from here on, updates install from inside the app.

## New in 0.3.4

- **See which model your coaches use.** A small label on the home page and next to every coach shows the model and how it's connected, for example "gpt-5.5 · ChatGPT plan". Click it to change.
- When coaching is off, the label says so, and so does the coach's first message.

## New in 0.3.3

**🛠️ Fixes for the desktop app**
- **Opening a problem no longer opens a second DataDojo window** on the setup screen.
- **Sign in with ChatGPT works on Mac.** The last step used to fail with "URLError": the app couldn't check secure connections. It now uses your Mac's own certificates, and if a sign-in fails it says why.
- **Practice without a coach.** Skip the coach setup and you can still solve every problem and run the tests; the coaches tell you they're off and how to turn them on. A name you typed before skipping is kept.

## New in 0.3.2

**⚡ Faster**
- Pages open in about a tenth of a second: problems are read once instead of on every page, and nothing waits on a setup check.
- The execution map opens instantly: it's prepared in the background while you read your test results.
- No more blank window on slow networks: the editor and fonts load in the background, and an "Opening DataDojo…" loader shows from the first moment.

**✨ Smoother**
- The execution map opens with a calm fade and a placeholder in its final shape, so nothing jumps.
- The map's growth chip no longer shows a correct O(n) solution in red.

## New in 0.3.1

**⏱️ Coding rounds**
- On the Interview page, pick SQL, Python, PySpark or ML & AI and a level for a **timed problem with a coach as your interviewer**.
- If your code works but is slower than it needs to be, you're asked to optimise it. Then answer one follow-up question (26 of them, from query plans to RAG evals), graded against a rubric.
- A report scores correctness, efficiency, time and the follow-up out of 100. Past rounds are kept.

**🧠 ML & AI from scratch**
- 18 new problems in plain Python: precision and recall, ROC AUC, log loss, NDCG, scaling and encoding without leakage, k-fold and stratified splits, k-NN, k-means, gradient descent, softmax, cosine search, chunking, BM25 and context packing. 252 problems in total.

**🔁 Your practice**
- The home page shows what's due: problems you struggled with come back after 1, 3 and 7 days, and reviews start from a blank editor.
- Your three weakest patterns, by first-try success, with the next problems to try.

**📈 Will it hold up on real data?**
- In the execution map, time your solution next to the reference on the test data grown to millions of rows, with a plain takeaway: whether it scales, and how fast it slows down if it doesn't. Fold the section away when you don't need it.

**✨ Also**
- The launch intro follows your theme: light mode gets a light intro.
- The map's verdict no longer calls a correct O(n) solution slower than the reference.

## New in 0.3.0

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
