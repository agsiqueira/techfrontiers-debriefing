const NAVIGATOR_URL = 'https://api.ai.it.ufl.edu/v1/chat/completions';

const state = {
  apiKey: localStorage.getItem('tf_apiKey') || '',
  model: localStorage.getItem('tf_model') || 'gpt-5-mini',
  pretalkText: '',
  pretalkFileName: '',
  studentName: '',
  presentationTitle: '',
  speakerName: '',
  moduleInfo: '',
  started: false,
  finished: false,
  awaiting: null,
  stageIndex: 0,
  transcript: [],
  feedback: [],
  answers: []
};

const stages = [
  { key:'impactfulIdea', label:'Key Ideas', main:'What was the most important or impactful idea from the presentation for you?', follow:'Why do you think that idea resonated with you personally?' },
  { key:'expectations', label:'Pre-Talk Expectations', main:'How did the presentation compare with what you expected before watching it?', follow:'Was there a particular moment or example from the presentation that changed how you were thinking about the topic?' },
  { key:'pretalkQuestions', label:'Pre-Talk Questions', main:'Which of your pre-talk questions were answered during the presentation?', follow:'What about the speaker’s explanation helped you understand the issue differently?' },
  { key:'evolvingUnderstanding', label:'Evolving Understanding', main:'How did your understanding of the topic evolve after the presentation?', follow:'Do you think the presentation challenged any assumptions you had before? Why or why not?' },
  { key:'industry5', label:'Industry 5.0 Connections', main:'How does this presentation connect to Industry 5.0 and human-centered technology?', follow:'Why do you think it matters that these technologies remain focused on people rather than technology alone?' },
  { key:'implications', label:'Broader Implications', main:'What societal, industrial, ethical, or human-centered implications should we consider based on this presentation?', follow:'What risks do you think could appear if technologies like this are developed without enough ethical consideration?' },
  { key:'remainingQuestions', label:'Remaining Questions', main:'What important question do you still have after the presentation?', follow:'Why do you think that question matters for the future of this technology?', noQuestionFollow:'That’s completely fine. Was there anything from the presentation that still made you curious or want to learn more?' },
  { key:'finalReflection', label:'Final Reflection', main:'What is your main takeaway from the presentation and this debriefing conversation?', follow:'Do you think this presentation changed how you personally view the role of technology in society? Why or why not?' }
];

const feedbackQuestions = [
  'Did this debriefing coach help you reflect more deeply on the presentation?',
  'Was any part of the conversation especially useful or confusing?',
  'What could improve this GPT-supported debriefing experience for future students?'
];

const el = id => document.getElementById(id);

function init() {
  el('apiKey').value = state.apiKey;
  el('modelName').value = state.model;
  el('sendBtn').addEventListener('click', handleSend);
  el('userInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
  el('saveSettingsBtn').addEventListener('click', saveSettings);
  el('uploadBtn').addEventListener('click', uploadPretalk);
  el('startBtn').addEventListener('click', startSession);
  el('finishBtn').addEventListener('click', finishSession);
  el('resetBtn').addEventListener('click', resetSession);
  addMessage('coach', 'Welcome. Upload your completed pre-talk reflection essay, save your NaviGator API key, and then start the debriefing session.');
  renderProgress();
}

function saveSettings() {
  state.apiKey = el('apiKey').value.trim();
  state.model = el('modelName').value.trim() || 'gpt-5-mini';
  localStorage.setItem('tf_apiKey', state.apiKey);
  localStorage.setItem('tf_model', state.model);
  addMessage('system', 'Settings saved.');
}

async function uploadPretalk() {
  try {
    const result = await window.electronAPI.selectPretalkFile();
    if (!result || result.canceled) return;
    state.pretalkText = result.text || '';
    state.pretalkFileName = result.fileName || '';
    parsePretalkFields();
    el('fileStatus').textContent = `Uploaded: ${state.pretalkFileName}`;
    addMessage('system', `Pre-talk reflection uploaded: ${state.pretalkFileName}`);
    addMessage('coach', `Thank you. I’ll use your pre-talk reflection to guide the conversation, but I won’t summarize it back to you. When you are ready, click “Start Debriefing.”`);
  } catch (err) {
    addMessage('warning', `Upload failed: ${err.message}`);
  }
}

function parsePretalkFields() {
  const t = state.pretalkText;
  function find(label) {
    const re = new RegExp(label + '\\s*:?\\s*([^\\n]+)', 'i');
    const m = t.match(re);
    return m ? m[1].trim() : '';
  }
  state.studentName = find('Student Name');
  state.presentationTitle = find('Presentation Title');
  state.speakerName = find('Speaker Name');
  state.moduleInfo = find('Module Number') || find('Module Number and Title');
}

function startSession() {
  if (!state.apiKey) { addMessage('warning', 'Please save your NaviGator API key first.'); return; }
  if (!state.pretalkText) { addMessage('warning', 'Please upload your completed pre-talk reflection essay first.'); return; }
  state.started = true;
  state.finished = false;
  state.stageIndex = 0;
  state.awaiting = { type:'main', stage:0, question:stages[0].main };
  addMessage('coach', `Let’s begin. ${stages[0].main}`);
  renderProgress();
}

function resetSession() {
  if (!confirm('Reset this session? This clears the current transcript and answers.')) return;
  state.started = false; state.finished = false; state.awaiting = null; state.stageIndex = 0;
  state.transcript = []; state.feedback = []; state.answers = [];
  el('chatMessages').innerHTML = '';
  addMessage('coach', 'Session reset. Upload your pre-talk reflection or start again when ready.');
  renderProgress();
}

async function handleSend() {
  const input = el('userInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMessage('user', text);

  if (!state.started) {
    addMessage('coach', 'Please upload your pre-talk reflection and click “Start Debriefing” first.');
    return;
  }

  if (!state.awaiting) {
    addMessage('coach', 'You can click “Finish and Generate Report” when you are ready, or continue sharing anything else you want included.');
    return;
  }

  if (isQuestion(text)) {
    await answerStudentQuestionThenReturn(text);
    return;
  }

  if (wordCount(text) < 3) {
    addMessage('warning', `Your response is currently too brief for a meaningful reflective debriefing. The goal is thoughtful reflection and critical engagement. A Reflection Transcript documenting this conversation will be included in the final document, and the instructional team will review the submission using the course rubric.\n\nPlease answer the question again with additional detail.\n\n${state.awaiting.question}`);
    return;
  }

  const current = state.awaiting;
  state.transcript.push({ question: current.question, answer: text });

  if (current.type === 'feedback') {
    state.feedback.push({ question: current.question, answer: text });
    await advanceFeedback();
    return;
  }

  state.answers.push({ stageKey: stages[current.stage].key, type: current.type, question: current.question, answer: text });
  const reflection = await generateConversationalReflection(text, current);
  if (reflection) addMessage('coach', reflection);

  if (current.type === 'main') {
    const stageConfig = stages[current.stage];
    const follow = (stageConfig.key === 'remainingQuestions' && expressesNoRemainingQuestions(text))
      ? stageConfig.noQuestionFollow
      : stageConfig.follow;
    state.awaiting = { type:'follow', stage:current.stage, question:follow };
    addMessage('coach', follow);
  } else {
    const nextStage = current.stage + 1;
    if (nextStage < stages.length) {
      state.stageIndex = nextStage;
      const q = stages[nextStage].main;
      state.awaiting = { type:'main', stage:nextStage, question:q };
      addMessage('coach', q);
    } else {
      state.awaiting = null;
      addMessage('coach', 'Thank you. We have completed the main reflection. Would you be willing to answer a few brief questions about the GPT experience? This part is optional and not graded. If yes, type “yes.” If not, click “Finish and Generate Report.”');
      state.awaiting = { type:'feedbackConsent', question:'Would you be willing to answer a few brief questions about the GPT experience? This part is optional and not graded.' };
    }
  }
  renderProgress();
}

async function advanceFeedback() {
  const idx = state.feedback.length;
  if (idx < feedbackQuestions.length) {
    const q = feedbackQuestions[idx];
    state.awaiting = { type:'feedback', question:q };
    addMessage('coach', q);
  } else {
    state.awaiting = null;
    addMessage('coach', 'Thank you for the feedback. You can now click “Finish and Generate Report” to create your final DOCX document.');
  }
}

async function answerStudentQuestionThenReturn(questionText) {
  addMessage('coach', await askModelForStudentQuestion(questionText));
  addMessage('coach', `Let’s return to the reflection question:\n\n${state.awaiting.question}`);
}

async function askModelForStudentQuestion(questionText) {
  const messages = [
    { role:'system', content:`You are a warm, concise course debriefing coach. The user asked a question instead of answering the current reflection prompt. Answer directly and briefly in 1-3 sentences, then do not ask a new question. Do not say “based on the student” or “a fitting question could be.” Talk directly to the user.` },
    { role:'user', content:`Pre-talk reflection context:\n${state.pretalkText.slice(0,4000)}\n\nCurrent reflection prompt: ${state.awaiting.question}\n\nStudent question: ${questionText}` }
  ];
  return await callNavigator(messages, 220);
}

async function generateConversationalReflection(answer, current) {
  const stage = current.stage != null ? stages[current.stage] : null;
  const messages = [
    { role:'system', content:`You are a conversational debriefing coach speaking directly to the student. Write exactly ONE short sentence reacting to the student's answer. Speak in second person using words like “you” or “it sounds like.” Do NOT refer to “the student.” Do NOT say “based on your reflection,” “a fitting Socratic follow-up,” “this response suggests,” or any meta-commentary about prompts. Do NOT ask a question. Keep it natural, warm, and specific.` },
    { role:'user', content:`Current topic: ${stage ? stage.label : 'Reflection'}\nQuestion asked: ${current.question}\nStudent answer: ${answer}\n\nWrite one conversational sentence to acknowledge and lightly reason about the answer.` }
  ];
  let response = await callNavigator(messages, 90);
  response = cleanMetaLanguage(response);
  return response;
}

function cleanMetaLanguage(text) {
  let t = String(text || '').trim();
  const bannedStarts = [
    /^Based on .*?,?\s*/i,
    /^A fitting Socratic follow-up question could be:?\s*/i,
    /^A good follow-up question could be:?\s*/i,
    /^The student'?s?\s+/i,
    /^This response suggests that\s+/i,
    /^This reflection suggests that\s+/i
  ];
  for (const re of bannedStarts) t = t.replace(re, '');
  t = t.replace(/\bthe student\b/gi, 'you');
  t = t.replace(/\bJordan Miller's reflection\b/gi, 'your reflection');
  if (/[?]$/.test(t)) t = 'That is a helpful point to carry into the next part of the reflection.';
  return t || 'That is a helpful point to carry into the next part of the reflection.';
}

async function finishSession() {
  if (!state.started) { addMessage('warning', 'Please complete or start a session before generating the report.'); return; }
  addMessage('coach', 'I’m generating the final report now. Please review and revise it before uploading it to Canvas.');
  const reportText = await generateReport();
  const saveResult = await window.electronAPI.saveDocxReport({
    studentName: state.studentName || 'Student',
    reportText,
    transcript: state.transcript,
    feedback: state.feedback
  });
  if (saveResult && !saveResult.canceled) {
    addMessage('system', `Final DOCX saved: ${saveResult.filePath}`);
    addMessage('coach', 'Your final document has been generated. Please review and revise it as needed, then upload it to the appropriate Canvas assignment. The instructional team will review and grade the submission, and the Canvas upload is required for the assignment to count as submitted.');
  }
}

function getAnswer(stageKey, type='main') {
  const item = state.answers.find(a => a.stageKey === stageKey && a.type === type);
  return item ? item.answer.trim() : '';
}

function cleanReportValue(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

function extractPretalkSection(sectionNumber) {
  const text = String(state.pretalkText || '').replace(/\r/g, '');
  const patterns = [
    new RegExp(`Section\\s+${sectionNumber}\\s*[–-][^\\n]*\\n([\\s\\S]*?)(?=\\n\\s*Section\\s+${sectionNumber + 1}\\s*[–-]|\\n\\s*Pre-Talk Reflection Essay Rubric|$)`, 'i'),
    new RegExp(`Section\\s+${sectionNumber}[^\\n]*\\n([\\s\\S]*?)(?=\\n\\s*Section\\s+${sectionNumber + 1}|\\n\\s*Pre-Talk Reflection Essay Rubric|$)`, 'i')
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      return m[1]
        .replace(/Response:\s*/i, '')
        .replace(/Question\s*\d\s*:/gi, 'Question:')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !/^[-•]/.test(line) && !/^Prior knowledge/i.test(line) && !/^Technologies you/i.test(line) && !/^Personal experiences/i.test(line) && !/^Assumptions/i.test(line) && !/^Applications/i.test(line) && !/^Societal impact/i.test(line) && !/^Industrial transformation/i.test(line) && !/^Ethical implications/i.test(line) && !/^Future careers/i.test(line) && !/^Human-centered innovation/i.test(line) && !/^Education or healthcare/i.test(line))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }
  return '';
}

function buildSectionFromAnswers(stageKey, introMain, introFollow) {
  const main = cleanReportValue(getAnswer(stageKey, 'main'));
  const follow = cleanReportValue(getAnswer(stageKey, 'follow'));
  const parts = [];
  if (main) parts.push(`${introMain} ${main}`);
  if (follow) parts.push(`${introFollow} ${follow}`);
  return parts.join(' ');
}

async function generateReport() {
  // Faithful report mode: organize the student's own words without expanding ideas.
  // This intentionally does not ask the model to improve, deepen, or reinterpret the reflection.
  const s1 = cleanReportValue(extractPretalkSection(1));
  const s3 = cleanReportValue(extractPretalkSection(3));
  const s5 = cleanReportValue(extractPretalkSection(5));
  const expectationParts = [];
  if (s1) expectationParts.push(`Before the presentation, my initial understanding was: ${s1}`);
  if (s3) expectationParts.push(`My interests, concerns, and predictions were: ${s3}`);
  if (s5) expectationParts.push(`My learning goal was: ${s5}`);

  const sections = [
    ['Student Name', state.studentName || ''],
    ['Presentation Information', [
      `Presentation Title: ${state.presentationTitle || ''}`,
      `Speaker Name: ${state.speakerName || ''}`,
      `Module Number: ${state.moduleInfo || ''}`
    ].filter(Boolean).join('\n')],
    ['Summary of Initial Expectations', expectationParts.join(' ') || 'No pre-talk expectation text was available from the uploaded document.'],
    ['Key Insights from the Presentation', buildSectionFromAnswers('impactfulIdea', 'The most important or impactful idea from the presentation for me was:', 'This idea stood out to me because:')],
    ['Reflection on Pre-Talk Questions', buildSectionFromAnswers('pretalkQuestions', 'The pre-talk questions that were answered were:', 'The speaker’s explanation helped me understand the issue differently in this way:')],
    ['Evolving Understanding of the Topic', buildSectionFromAnswers('evolvingUnderstanding', 'My understanding of the topic evolved in this way:', 'When thinking about whether my assumptions were challenged, I said:')],
    ['Industry 5.0 Connections', buildSectionFromAnswers('industry5', 'I connected the presentation to Industry 5.0 and human-centered technology in this way:', 'I think keeping these technologies focused on people matters because:')],
    ['Societal and Human-Centered Implications', buildSectionFromAnswers('implications', 'The societal, industrial, ethical, or human-centered implications I identified were:', 'The risks I think could appear without enough ethical consideration are:')],
    ['Remaining Questions and Future Considerations', buildSectionFromAnswers('remainingQuestions', 'After the presentation, my remaining question or curiosity was:', 'I explained its importance this way:')],
    ['Final Reflection', buildSectionFromAnswers('finalReflection', 'My main takeaway from the presentation and debriefing conversation was:', 'This may influence how I think about emerging technologies going forward because:')]
  ];

  return sections.map(([title, body]) => {
    const safeBody = cleanReportValue(body) || 'No response was provided for this section.';
    return `${title}\n${safeBody}`;
  }).join('\n\n');
}

async function callNavigator(messages, maxTokens=500) {
  const res = await fetch(NAVIGATOR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.apiKey}` },
    body: JSON.stringify({ model: state.model, messages, max_tokens: maxTokens, temperature: 0.45 })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`NaviGator API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function isQuestion(text) {
  const t = text.trim();
  if (t.endsWith('?')) return true;
  return /^(what|why|how|when|where|who|can|could|should|would|do|does|did|is|are|am|will)\b/i.test(t);
}
function expressesNoRemainingQuestions(text) {
  return /\b(no questions|no question|don'?t have (any )?questions|do not have (any )?questions|nothing else|none)\b/i.test(text.trim());
}
function wordCount(text) { return (text.trim().match(/\b[\w'’-]+\b/g) || []).length; }
function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  el('chatMessages').appendChild(wrap);
  scrollToBottom();
}
function scrollToBottom() {
  const c = el('chatMessages');
  requestAnimationFrame(() => c.scrollTo({ top:c.scrollHeight, behavior:'smooth' }));
}
function renderProgress() {
  const list = el('progressList');
  list.innerHTML = '';
  stages.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = `${i < state.stageIndex ? '✓ ' : i === state.stageIndex && state.started ? '→ ' : ''}${s.label}`;
    list.appendChild(li);
  });
}

// Special handling for feedback consent after a user types yes/no
const originalHandleSend = handleSend;
async function handleFeedbackConsentAnswer(text) {}

// Patch inside event by intercepting before normal logic
const oldHandleSend = handleSend;
handleSend = async function() {
  const input = el('userInput');
  const text = input.value.trim();
  if (!text) return;
  if (state.awaiting && state.awaiting.type === 'feedbackConsent') {
    input.value = '';
    addMessage('user', text);
    state.transcript.push({ question: state.awaiting.question, answer: text });
    if (/^y(es)?\b/i.test(text)) {
      const q = feedbackQuestions[0];
      state.awaiting = { type:'feedback', question:q };
      addMessage('coach', q);
    } else {
      state.awaiting = null;
      addMessage('coach', 'No problem. You can click “Finish and Generate Report” when you are ready.');
    }
    return;
  }
  return oldHandleSend();
}

init();
