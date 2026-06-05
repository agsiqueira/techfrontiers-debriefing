const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = require('docx');

const CIMATEC_PROXY_URL = 'https://tech-frontiers-senai-cimatec-openai-proxy.alexandre-g-siqueira.workers.dev/';
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('select-pretalk-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Pre-Talk Reflection Essay',
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['docx', 'txt'] }
    ]
  });

  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  let text = '';

  if (ext === '.docx') {
    const buffer = fs.readFileSync(filePath);
    const extracted = await mammoth.extractRawText({ buffer });
    text = extracted.value || '';
  } else if (ext === '.txt') {
    text = fs.readFileSync(filePath, 'utf8');
  } else {
    throw new Error('Unsupported file type. Please upload a .docx or .txt file.');
  }

  return { canceled: false, fileName: path.basename(filePath), text };
});

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function normalizeHeading(text) {
  return cleanText(text).replace(/:$/, '').trim();
}

function textPara(text, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before ?? 0, after: opts.after ?? 160, line: 276 },
    children: [new TextRun({ text: String(text || ''), size: 22 })]
  });
}

function labelPara(label, value) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 22 }),
      new TextRun({ text: String(value || ''), size: 22 })
    ]
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  const isH1 = level === HeadingLevel.HEADING_1;
  return new Paragraph({
    text: normalizeHeading(text),
    heading: level,
    spacing: { before: isH1 ? 180 : 280, after: isH1 ? 180 : 120 }
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

const REPORT_SECTION_TITLES = [
  'Student Name',
  'Presentation Information',
  'Summary of Initial Expectations',
  'Key Insights from the Presentation',
  'Reflection on Pre-Talk Questions',
  'Evolving Understanding of the Topic',
  'Industry 5.0 Connections',
  'Societal and Human-Centered Implications',
  'Remaining Questions and Future Considerations',
  'Final Reflection'
];

function canonicalSectionTitle(line) {
  const normalized = normalizeHeading(line).toLowerCase();
  return REPORT_SECTION_TITLES.find(t => t.toLowerCase() === normalized) || null;
}

function parseReportSections(reportText) {
  const sections = [];
  let current = null;
  const rawLines = cleanText(reportText).split('\n');

  for (const raw of rawLines) {
    const line = cleanText(raw);
    if (!line) continue;
    if (/^final post-talk debriefing report$/i.test(normalizeHeading(line))) continue;

    const title = canonicalSectionTitle(line);
    if (title) {
      if (current) sections.push(current);
      current = { title, paragraphs: [] };
      continue;
    }

    if (!current) {
      current = { title: 'Summary of Initial Expectations', paragraphs: [] };
    }
    current.paragraphs.push(line);
  }
  if (current) sections.push(current);

  // Keep sections in required order and include any missing sections with blank body.
  const byTitle = new Map(sections.map(s => [s.title, s]));
  return REPORT_SECTION_TITLES.map(title => byTitle.get(title) || { title, paragraphs: [] });
}

function addReportSection(children, section) {
  if (section.title === 'Student Name') {
    const value = (section.paragraphs.join(' ') || '').replace(/^Student Name\s*:?\s*/i, '').trim();
    if (value) children.push(labelPara('Student Name', value));
    return;
  }

  children.push(heading(section.title, HeadingLevel.HEADING_2));

  if (!section.paragraphs.length) {
    children.push(textPara(''));
    return;
  }

  for (const paragraph of section.paragraphs) {
    const cleaned = cleanText(paragraph);
    if (!cleaned) continue;

    // If the model returns metadata lines inside Presentation Information, preserve them cleanly.
    const metadata = cleaned.match(/^([^:]{2,60}):\s*(.+)$/);
    if (section.title === 'Presentation Information' && metadata) {
      children.push(labelPara(metadata[1].trim(), metadata[2].trim()));
    } else {
      children.push(textPara(cleaned));
    }
  }
}

ipcMain.handle('save-docx-report', async (_event, payload) => {
  const defaultName = `Final_PostTalk_Debriefing_Report_${(payload.studentName || 'Student').replace(/[^a-z0-9]/gi, '_')}.docx`;
  const result = await dialog.showSaveDialog({
    title: 'Save Final Debriefing Report',
    defaultPath: defaultName,
    filters: [{ name: 'Word Document', extensions: ['docx'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const children = [];
  children.push(heading('Final Post-Talk Debriefing Report'));

  const sections = parseReportSections(payload.reportText || '');
  for (const section of sections) {
    addReportSection(children, section);
  }

  children.push(pageBreak());
  children.push(heading('Reflection Transcript'));
  if (!payload.transcript || !payload.transcript.length) {
    children.push(textPara('No reflection transcript was recorded.'));
  } else {
    (payload.transcript || []).forEach((item, idx) => {
      children.push(heading(`Exchange ${idx + 1}`, HeadingLevel.HEADING_3));
      children.push(labelPara('Coach', item.question || ''));
      children.push(labelPara('Student', item.answer || ''));
    });
  }

  children.push(pageBreak());
  children.push(heading('GPT Experience Feedback'));
  children.push(textPara('This feedback section was optional and was not graded.'));
  if (!payload.feedback || !payload.feedback.length) {
    children.push(textPara('No optional GPT experience feedback was provided.'));
  } else {
    (payload.feedback || []).forEach((item, idx) => {
      children.push(heading(`Feedback ${idx + 1}`, HeadingLevel.HEADING_3));
      children.push(labelPara('Question', item.question || ''));
      children.push(labelPara('Response', item.answer || ''));
    });
  }

  children.push(heading('Submission Reminder'));
  children.push(textPara('Please review and revise this document before submitting it. The instructional team will review and grade the submission. Uploading the final document is required for the assignment to count as submitted.'));

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true },
          paragraph: { spacing: { before: 240, after: 160 } }
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true },
          paragraph: { spacing: { before: 260, after: 120 } }
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 23, bold: true },
          paragraph: { spacing: { before: 200, after: 80 } }
        }
      ]
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children
    }]
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('call-cimatec', async (_event, payload) => {
  const response = await fetch(CIMATEC_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: payload.messages,
      maxTokens: payload.maxTokens
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CIMATEC proxy error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.content || '';
});
