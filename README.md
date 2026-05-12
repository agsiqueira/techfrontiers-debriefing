# Tech Frontiers Debriefing Coach

Electron desktop app for CIS4930: Technology Frontiers for Industry 5.0.

## Run in development

```powershell
npm install
npm start
```

## Build for Windows

```powershell
npm run build:win
```

If an installer is not created, use the portable app in:

```text
dist\win-unpacked
```

Share the entire `win-unpacked` folder, not only the `.exe`.

## Student use

1. Open the app.
2. Paste UF NaviGator API key.
3. Confirm model name.
4. Upload completed pre-talk reflection `.docx`.
5. Click Start Debriefing.
6. Complete the conversation.
7. Generate the final DOCX and upload to Canvas.

## Behavior

- Fixed left sidebar and auto-scrolling chat area.
- Native DOCX upload.
- Uses UF NaviGator OpenAI-compatible endpoint.
- Asks one main question and one Socratic follow-up per stage.
- Treats answers under 3 words as too short.
- If a student asks a question, the coach answers briefly and returns to the active prompt.
- Reflection-check messages speak directly to the student and avoid third-person/meta phrasing.

- Final reports are written in first person, using the student’s own reflective voice.
