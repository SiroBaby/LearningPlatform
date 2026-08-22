# UI Requirements — AI Learning Platform Production Product

> Purpose: This document is a complete product UI requirement brief for an AI design generator or UI/UX designer. It describes the production-facing interface for the full LearningPlatform product, not only Phase 0. It should guide screen generation, layout, interaction states, responsive behavior, and accessibility.
>
> Product positioning: LearningPlatform helps learners turn their own learning materials into active learning experiences: upload documents or videos, get grounded quizzes/checkpoints/flashcards, answer questions, receive feedback, track weak areas, and review at the right time.

---

## 1. Product North Star

The interface must make one loop obvious:

```text
Upload learning material -> AI creates active recall tasks -> learner answers -> system gives feedback -> learner improves weak areas
```

The UI must not feel like a generic AI chatbot or file manager. It should feel like a focused learning cockpit: every surface should push the learner toward active recall, feedback, review, and progress.

Primary user promise:

```text
Bring your PDF, text, video, or audio. The platform turns it into quizzes, checkpoints, explanations, and a personalized review plan with source citations.
```

---

## 2. Target Users

### 2.1 Primary B2C Learner

- Vietnamese/SEA student, university student, high school student, or self-learner.
- Uploads lecture slides, PDFs, textbook chapters, notes, or videos.
- Wants to check whether they understood the material.
- Cares about speed, trust, citation, and exam preparation.
- Often uses mobile for quick review, desktop for upload/study sessions.

### 2.2 Power Learner

- Uses many documents across subjects.
- Wants study plans, spaced repetition, weak-topic analytics, and exam simulation.
- Needs organization by course, subject, exam, tag, and deadline.

### 2.3 Teacher / Creator / Tutor

- Uploads course material for a group/class.
- Wants to generate quizzes, checkpoints, assignments, and analytics.
- Needs classroom dashboards, export/share, and student progress visibility.

### 2.4 Admin / Operator

- Monitors abusive uploads, processing cost, model usage, failed jobs, billing, and support issues.
- Needs safe operational views, but this can be lower visual priority than learner-facing UI.

---

## 3. Product Scope Covered By This UI Spec

The production UI should include these product areas:

- Public marketing website.
- Authentication and onboarding.
- Learner home dashboard.
- Upload and document processing flow.
- Document library.
- Document detail and source viewer.
- AI-generated quiz experience.
- Attempt results and explanations.
- Interactive video checkpoint experience.
- Flashcards and spaced repetition.
- AI Tutor with source-grounded answers.
- Course / collection organization.
- Learning analytics and weak-topic insights.
- Study plan / review queue.
- Exam preparation mode.
- Billing, credits, subscription, usage limits.
- Settings and account management.
- Teacher/classroom surfaces.
- Admin/operator surfaces.
- System states, empty states, loading, error, offline, and mobile behavior.

---

## 4. Design Principles

### 4.1 Active Learning First

The UI must constantly move the learner from passive reading/watching into active recall. Avoid screens that only display generated content without asking the learner to do something.

### 4.2 Trust Through Source Grounding

Every generated question, answer, explanation, and tutor response should be able to show its source: page number, timestamp, text snippet, or document chunk. Citation must be visible enough to build trust, not hidden as an afterthought.

### 4.3 Vietnamese-Friendly But Globally Usable

Design must support Vietnamese text naturally: long diacritics, mixed English technical terms, long subject names, and exam-oriented workflows. Do not assume short English labels only.

### 4.4 Calm Study Interface

The product should feel focused, calm, and credible. Avoid overusing gradients, mascot-heavy gimmicks, or generic AI sparkle. AI should feel like a study assistant, not a toy.

### 4.5 Fast Perceived Feedback

Long-running AI jobs must never leave users wondering. Always show progress, current step, estimated wait, and what they can do while waiting.

### 4.6 Mobile Review, Desktop Creation

Desktop is ideal for upload, source review, deep quiz sessions, and teacher/admin tools. Mobile is essential for quick flashcards, review queue, quiz attempts, and checking status.

---

## 5. Visual Direction

### 5.1 Desired Feel

- Smart, focused, trustworthy, modern, academic, slightly premium.
- Should feel more like a learning workspace than a SaaS admin panel.
- Should have enough warmth to motivate students, but not look childish.

### 5.2 Suggested Visual Language

- Base: clean neutral canvas with strong typography.
- Accent: one primary learning color, e.g. indigo, blue-violet, teal, or green-blue.
- Secondary accents: success green, warning amber, error red, mastery purple, review orange.
- Use subtle cards, source panels, progress rings, timelines, and checkpoint markers.
- Use visual metaphors: knowledge map, checkpoints, mastery, recall queue, source-backed answer.

### 5.3 Avoid

- Generic AI dashboard full of glowing blobs and meaningless charts.
- Overly corporate admin UI.
- Too many gradients at once.
- Hidden citations.
- Tiny text in study content.
- Dense tables for learner-facing pages unless the user is managing many documents.

---

## 6. Global Navigation

### 6.1 Logged-Out Navigation

Header items:

- Logo / product name.
- Product.
- Use cases.
- Pricing.
- Examples.
- Login.
- Primary CTA: Start free / Upload your first document.

Mobile header:

- Logo.
- Menu button.
- CTA visible or inside menu.
- Menu must be keyboard accessible and close on route change / Escape.

### 6.2 Logged-In Learner Navigation

Primary nav:

- Home.
- Library.
- Review.
- Tutor.
- Analytics.
- Courses.
- Upload.

Secondary/account nav:

- Notifications.
- Usage / credits.
- Settings.
- Help.
- Profile menu.

Navigation requirements:

- Current page state must be clear.
- Mobile bottom nav should prioritize Home, Library, Review, Tutor, Upload.
- Upload should remain globally reachable.
- Long-running processing jobs should be visible globally via a small status indicator.

### 6.3 Teacher Navigation

- Teacher Home.
- Classes.
- Materials.
- Assignments.
- Student Progress.
- Question Bank.
- Billing.

### 6.4 Admin Navigation

- Overview.
- Users.
- Documents.
- Jobs.
- AI Cost.
- Moderation.
- Billing.
- Support.
- System Health.

---

## 7. Public Marketing Website

### 7.1 Landing Page

Goal: convert a visitor into uploading a first document or signing up.

Required sections:

- Hero with one clear promise.
- Upload-demo preview: drag a PDF/video, see generated quiz/checkpoint mock.
- Problem section: passive learning, forgotten content, exam stress.
- How it works: Upload -> AI builds recall tasks -> Learn with feedback.
- Product preview: document library, quiz, video checkpoint, tutor, analytics.
- Trust section: grounded citations, source snippets, no blind hallucination.
- Use cases: students, self-learners, teachers, exam prep.
- Vietnamese/SEA focus: Vietnamese documents, local exam workflows, affordable pricing.
- Pricing teaser.
- FAQ.
- Final CTA.

Hero requirements:

- One sentence value proposition.
- Primary CTA: Start free.
- Secondary CTA: View example.
- Visual should show a document transformed into quiz/checkpoint cards.
- Must not overpromise perfect AI. Use copy like “source-grounded questions” rather than “always correct”.

Example hero copy:

```text
Turn your study materials into quizzes, checkpoints, and feedback you can trust.
Upload a PDF or lecture video. LearningPlatform creates active recall tasks with source citations.
```

### 7.2 Product Page

Sections:

- Document-to-quiz.
- Video checkpoints.
- AI Tutor.
- Flashcards and spaced repetition.
- Weak-topic analytics.
- Exam preparation.
- Teacher/classroom tools.

Each feature should show:

- User problem.
- UI preview.
- Output example.
- Why it is trustworthy.

### 7.3 Pricing Page

Plans to represent:

- Free.
- Student Plus.
- Pro Learner.
- Teacher / Classroom.
- Enterprise / School.

Pricing UI must show:

- Monthly/yearly toggle.
- Included uploads/pages/minutes.
- AI credits.
- Max file size.
- Video processing availability.
- Tutor availability.
- Analytics availability.
- Overage or top-up rules.
- Fair-use notes.

### 7.4 Example / Demo Gallery

Purpose: show what the product can generate without requiring signup.

Example items:

- Vietnamese lecture PDF -> quiz.
- English technical article -> flashcards.
- Video lecture -> checkpoints.
- Exam chapter -> practice test.

Each example should allow visitors to inspect:

- Source excerpt.
- Generated question.
- Explanation.
- Citation.
- Result screen.

---

## 8. Authentication And Onboarding

### 8.1 Auth Screens

Required screens:

- Sign up.
- Login.
- Forgot password.
- Reset password.
- Email verification.
- OAuth continuation if supported.
- Account locked / suspicious login.

Auth requirements:

- Clean two-column desktop layout: form + product proof/demo.
- Mobile single-column layout.
- Email/password fields with clear labels.
- Password visibility toggle.
- Error messages close to fields.
- No disabled submit that hides validation feedback.

### 8.2 First-Time Onboarding

Goal: get user to first value quickly.

Steps:

1. Ask learning goal: exam prep, course study, self-learning, teaching.
2. Ask preferred language: Vietnamese, English, mixed.
3. Ask level: high school, university, professional, other.
4. Prompt first upload or choose sample document.
5. Show short explanation of citation and AI limitations.

Onboarding should be skippable but recoverable from settings.

### 8.3 Empty Account First Run

Home page should not be an empty dashboard. It should show:

- “Upload your first material” CTA.
- “Try a sample” CTA.
- 3-step explanation.
- Example generated quiz preview.
- Privacy/security note about uploaded materials.

---

## 9. Learner Home Dashboard

### 9.1 Purpose

The home dashboard answers:

- What should I study now?
- What is ready?
- What is processing?
- Where am I weak?
- What progress did I make recently?

### 9.2 Required Sections

- Primary action card: Upload material / Continue studying.
- Today’s review queue.
- Processing jobs status.
- Recently ready documents.
- Continue quiz/attempt.
- Weak topics summary.
- Study streak and weekly progress.
- Usage/credits warning if near limit.
- Recommended next action.

### 9.3 Dashboard Cards

Cards should include:

- Document title.
- Type: PDF, text, video, audio.
- Status: Uploaded, Processing, Ready, Failed.
- AI outputs available: Quiz, Flashcards, Tutor, Checkpoints.
- Last studied.
- Mastery percentage or confidence score.
- Next recommended action.

### 9.4 Empty/Sparse/Dense States

Empty:

- Show onboarding content and upload CTA.

Sparse:

- Show one document prominently and explain next step.

Dense:

- Collapse into sections with filters and search.

---

## 10. Upload Flow

### 10.1 Upload Entry Points

Upload should be reachable from:

- Global nav.
- Home dashboard.
- Library.
- Course detail.
- Empty states.

### 10.2 Upload Screen

Supported production types:

- PDF.
- Plain text / pasted text.
- Video.
- Audio.
- Future: DOCX/PPTX/images if supported.

Required elements:

- Drag-and-drop upload zone.
- Browse file button.
- Paste text option.
- Import from URL option if supported.
- Supported formats and limits.
- Privacy note.
- AI credit estimate before processing.
- Processing source selector: Platform Model or a verified Custom AI Configuration.
- Option to assign to course/collection.
- Option to select generation goals: quiz, flashcards, video checkpoints, tutor index.
- Language selector / auto-detect.

### 10.3 File Preflight UI

Before confirm/process:

- File name.
- File type.
- File size.
- Estimated pages/minutes.
- Estimated processing time.
- Estimated credit cost.
- Current platform credit balance, required credits, shortfall, and whether processing can start.
- For Custom AI, show zero platform credits with an explicit warning that the Owner's provider may charge separately.
- Selected outputs.
- Warning if file too large or unsupported.
- If preflight shows insufficient platform credit, block starting the upload with that Platform Model and offer: choose verified Custom AI, choose a smaller file, or upgrade/top up when available.
- If balance changes after a successful preflight and confirm returns `402 INSUFFICIENT_CREDITS`, keep the uploaded Document reusable and offer the same recovery actions without re-uploading.

### 10.4 Upload Progress

States:

- Waiting for file.
- Uploading to storage.
- Upload complete, verifying.
- Verification failed.
- Ready to process.
- Processing started.

Progress UI:

- Percent for upload.
- Step status for verification.
- Retry button for recoverable failures.
- Cancel button while safe.

### 10.5 Processing Progress

Processing is async. UI must show:

- Document status.
- Current pipeline step.
- Step timeline.
- Estimated remaining time when available.
- “You can leave this page” message.
- Notification when ready.

Pipeline steps to represent:

- Verified.
- Extracting text / transcribing media.
- Chunking.
- Generating questions.
- Validating output.
- Building quiz/flashcards/checkpoints.
- Ready.

Failure state must include:

- Human-readable reason.
- Whether user can retry.
- Whether credits were charged/refunded.
- Support/report action.
- A distinct semantic state for `QUIZ_NOT_READY`, `DOCUMENT_PROCESSING_FAILED`, and an actual system error; never present a missing Quiz after failed processing as a generic 404.
- For retryable processing failures, allow model selection change and an explicit retry without re-uploading a valid source object.

---

## 11. Document Library

### 11.1 Purpose

Library is the learner’s source material hub.

### 11.2 Required Features

- Search documents.
- Filter by type, status, course, tag, date, mastery, output availability.
- Sort by recent, title, status, progress, created date.
- Grid/list toggle.
- Bulk actions: move to course, tag, delete, retry failed jobs.
- Upload CTA.

### 11.3 Document Card

Each document card should show:

- Title.
- Type icon.
- Upload date.
- Status.
- Processing progress if active.
- Outputs available: quiz, flashcards, tutor, checkpoints.
- Last attempt score.
- Mastery indicator.
- Quick actions: Open, Quiz, Review, Tutor, More.

### 11.4 Library Empty State

Show:

- Upload CTA.
- Try sample CTA.
- Explanation of supported material.
- Privacy reassurance.

---

## 12. Document Detail Page

### 12.1 Purpose

Document detail is the hub for one source material and everything generated from it.

### 12.2 Layout

Desktop recommended layout:

- Header with title, status, type, course, actions.
- Left/main: source preview or learning activity.
- Right/sidebar: generated outputs, progress, citations, actions.

Mobile layout:

- Stack sections.
- Sticky bottom action for primary next step.
- Source viewer can open full-screen.

### 12.3 Required Sections

- Source preview.
- Processing status if not ready.
- Generated quiz summary.
- Flashcard deck summary.
- Video checkpoint summary for media.
- Tutor entry point.
- Attempts history.
- Weak topics from this document.
- Source metadata.
- Regenerate actions with credit warning.

### 12.4 Source Viewer

PDF/text requirements:

- Show page/text content.
- Search within source.
- Highlight cited snippets.
- Jump from question citation to source location.
- Page navigation.

Video/audio requirements:

- Player with transcript.
- Timeline checkpoint markers.
- Timestamp citation jump.
- Transcript search.
- Current segment highlight.

---

## 13. Quiz Experience

### 13.1 Quiz Start Screen

Before starting:

- Quiz title.
- Source document.
- Number of questions.
- Estimated time.
- Difficulty mix if available.
- Coverage summary.
- Previous attempts.
- CTA: Start quiz / Resume attempt.
- Option: practice mode vs test mode.

### 13.2 Question Screen

Required elements:

- Question number and progress.
- Question stem.
- Single-select options.
- Clear selected state.
- Flag for review.
- Skip / next / previous.
- Optional source hint, not full answer.
- Timer if test mode.
- Save progress automatically.

Important:

- Do not expose correct answer before submission.
- Do not reveal hidden answer via HTML labels or accessibility names.
- Keyboard navigation must support selecting options and moving between questions.

### 13.3 Quiz Navigation

- Question list / palette.
- Status per question: unanswered, answered, flagged.
- Submit button.
- Confirm submit if unanswered questions remain.

### 13.4 Quiz Modes

Practice mode:

- Can reveal explanation after each answer if configured.
- More supportive tone.

Test mode:

- No feedback until submit.
- Timer optional.
- Stronger submit confirmation.

### 13.5 Quiz Result Screen

Required elements:

- Score.
- Correct/incorrect count.
- Time spent.
- Mastery estimate.
- Topic breakdown.
- Per-question review.
- Correct answer.
- User selected answer.
- Explanation.
- Citation with source jump.
- CTA: Review mistakes, retry quiz, create flashcards, ask tutor, continue document.

### 13.6 Per-Question Review

For each question:

- Show correct/incorrect state.
- Show selected option.
- Show correct option.
- Show explanation.
- Show source citation snippet.
- Button: View source.
- Button: Ask tutor about this.
- Button: Add to review queue.

---

## 14. Interactive Video Checkpoint Experience

### 14.1 Purpose

This is a flagship differentiator. UI must make it feel special and useful.

### 14.2 Video Player Requirements

- Standard playback controls.
- Timeline markers for checkpoints.
- Transcript side panel.
- Chapter/segment list if available.
- Current checkpoint indicator.
- “Checkpoint mode” toggle.
- Playback resumes after checkpoint feedback.

### 14.3 Checkpoint Interaction

When video reaches a checkpoint:

- Video pauses automatically.
- Overlay/panel appears with one or more questions.
- Question references the segment just watched.
- User answers.
- System shows immediate feedback and explanation.
- Citation points to timestamp/transcript snippet.
- CTA: Continue video.

### 14.4 Checkpoint Review

Document detail should show:

- Number of checkpoints.
- Completed checkpoints.
- Missed checkpoints.
- Weak segments.
- Jump back to timestamp.
- Retry checkpoint.

### 14.5 Mobile Video

- Checkpoint overlay must not cover controls permanently.
- Large answer tap targets.
- Transcript can be collapsible.
- Continue button sticky after feedback.

---

## 15. Flashcards And Spaced Repetition

### 15.1 Flashcard Deck Page

Required elements:

- Deck title and source document/course.
- Card count.
- Due cards.
- New cards.
- Mastered cards.
- Start review CTA.
- Filters by topic, difficulty, due date.

### 15.2 Flashcard Review UI

- Front side.
- Reveal answer.
- Back side with explanation and citation.
- Rating buttons: Again, Hard, Good, Easy.
- Progress through due queue.
- Keyboard shortcuts.

### 15.3 Review Queue

Home/review page should show:

- Due today.
- Upcoming.
- Overdue.
- Estimated time.
- Course/document breakdown.

---

## 16. AI Tutor

### 16.1 Tutor Entry Points

Tutor can be entered from:

- Global Tutor nav.
- Document detail.
- Quiz result question.
- Source viewer selection.
- Video timestamp.

### 16.2 Tutor Layout

Desktop:

- Chat panel.
- Source/citation panel.
- Context selector: all documents, one course, one document, current page/timestamp.

Mobile:

- Chat first.
- Source panel opens as bottom sheet/fullscreen.

### 16.3 Tutor Requirements

- User can ask free-form questions.
- Assistant answers with source citations.
- If answer is not in source, assistant must say it cannot find enough source evidence.
- User can ask for simpler explanation, examples, quiz me, summarize this section.
- Citations must be clickable.
- Tutor should show which documents are in context.

### 16.4 Tutor Suggested Prompts

- Explain this like I’m 10.
- Quiz me on this chapter.
- What are the key formulas?
- What should I review before the exam?
- Compare these two concepts.
- Make 5 flashcards from this section.

---

## 17. Courses / Collections

### 17.1 Purpose

Courses group Documents by reference. Course does not own quizzes; Document remains source of generated learning content.

### 17.2 Course List

- Course cards.
- Document count.
- Overall mastery.
- Due reviews.
- Last studied.
- Create course CTA.

### 17.3 Course Detail

Sections:

- Overview.
- Documents.
- Study plan.
- Quizzes.
- Flashcards.
- Tutor with course context.
- Analytics.
- Exam prep.

### 17.4 Course Creation

Fields:

- Name.
- Subject.
- Goal/exam.
- Deadline.
- Language.
- Add documents.

---

## 18. Learning Analytics

### 18.1 Purpose

Analytics should answer:

- What do I know?
- What am I weak at?
- What should I review next?
- How am I improving over time?

### 18.2 Learner Analytics Dashboard

Required sections:

- Overall mastery.
- Weekly study time.
- Quiz accuracy trend.
- Weak topics.
- Strong topics.
- Documents needing review.
- Mistake patterns.
- Review consistency/streak.
- Upcoming exam readiness if configured.

### 18.3 Weak Topic Detail

For each weak topic:

- Topic name.
- Confidence/mastery score.
- Evidence: questions missed, documents, citations.
- Suggested actions: review source, retry quiz, ask tutor, flashcard review.

### 18.4 Chart Requirements

- Charts must have textual summaries.
- Do not rely only on color.
- Empty analytics must explain that data appears after attempts/reviews.

---

## 19. Study Plan And Review

### 19.1 Study Plan Page

Required elements:

- Today’s tasks.
- Due reviews.
- Recommended quiz retries.
- Documents to finish.
- Weak topics to revisit.
- Estimated time.
- Calendar/deadline view if exam configured.

### 19.2 Task Types

- Review flashcards.
- Retry missed quiz questions.
- Watch video segment checkpoint.
- Read cited source section.
- Ask tutor to explain a weak concept.
- Take practice exam.

### 19.3 Completion UI

- Mark tasks complete automatically where possible.
- Show progress after each task.
- Celebrate meaningful study completion without excessive gamification.

---

## 20. Exam Preparation Mode

### 20.1 Exam Setup

Fields:

- Exam name.
- Date.
- Subject/course.
- Documents included.
- Target score.
- Question type preference.

### 20.2 Exam Dashboard

- Days remaining.
- Readiness score.
- Coverage map.
- Weak areas.
- Recommended study schedule.
- Practice exam CTA.

### 20.3 Practice Exam UI

- Timed mode.
- Mixed questions from selected documents.
- Submit and results.
- Topic breakdown.
- Review incorrect answers with citations.

---

## 21. Billing, Credits, And Usage

### 21.1 Usage Page

Required elements:

- Current plan.
- AI credits remaining.
- Upload/page/minute usage.
- Reset date.
- Processing history.
- Cost/credit breakdown per document.
- Upgrade CTA.

### 21.2 Credit Estimate Before Processing

Before user starts expensive processing:

- Show estimated credits.
- Explain what consumes credits.
- Show current balance.
- Show required credits, shortfall, and a clear can/cannot-process result.
- Warn for long video/audio.
- Let user choose cheaper/faster mode if available.
- Let user switch to a verified Custom AI Configuration without leaving the flow.
- Explain that preflight is an estimate and the balance is checked again when processing is confirmed.

### 21.3 Limit States

- Free limit reached.
- File too large for plan.
- Not enough credits.
- Video processing requires upgrade.
- Tutor daily limit reached.

Limit UI must provide:

- Clear reason.
- Upgrade/top-up CTA.
- Alternative action where possible.
- Insufficient credit copy must state the exact shortfall and must not use generic runtime-failure language.
- A `402 INSUFFICIENT_CREDITS` response keeps the Document reusable; the UI must not ask the user to upload the same file again.

### 21.4 Subscription Management

- Plan comparison.
- Upgrade/downgrade.
- Payment methods.
- Invoices.
- Cancel subscription.
- Renewal date.
- Regional pricing support if relevant.

---

## 22. Notifications

### 22.1 Notification Types

- Document ready.
- Processing failed.
- Review due.
- Weak topic detected.
- Quiz result summary.
- Credit low.
- Subscription/payment issue.
- Teacher assignment due.

### 22.2 Notification Center

- List notifications.
- Mark as read.
- Filter by type.
- Deep link to relevant document/quiz/task.

### 22.3 Delivery Preferences

- In-app.
- Email.
- Push if mobile/PWA.

---

## 23. Settings

### 23.1 Account Settings

- Profile.
- Name.
- Email.
- Password.
- Connected accounts.
- Delete account.

### 23.2 Learning Preferences

- Preferred language.
- Explanation style.
- Difficulty preference.
- Review schedule.
- Exam goals.
- Default generation outputs.

### 23.3 Privacy And Data

- Uploaded documents visibility.
- Data export.
- Delete documents.
- Delete generated outputs.
- AI training/data usage policy display.

### 23.4 Accessibility Preferences

- Reduced motion.
- Larger text.
- High contrast.
- Captions/transcript defaults.

### 23.5 Custom AI Settings

- Available to Free and Paid Owners when the global feature is enabled.
- List multiple Owner-scoped configurations with display name, base URL, model, `hasApiKey`, verification status, last verification result, edit, verify, and delete actions.
- API key input is write-only. Never display, copy, or reveal the saved secret.
- Saving is allowed in `UNVERIFIED`; only `VERIFIED` configurations can be selected for a Document.
- Editing base URL, model, or API key returns the configuration to `UNVERIFIED`.
- Connection errors must distinguish unreachable endpoint, authentication failure, missing model, and incompatible response.
- Explain that SaaS cannot call `localhost` or private network endpoints; the first version supports reachable OpenAI-compatible endpoints only.
- Deleting uses a confirmation flow and removes the configuration from future selection without interrupting an attempt already running.
- When Admin disables Custom AI globally, preserve configurations read-only, explain why new actions are unavailable, and do not imply data was deleted.

---

## 24. Teacher / Classroom UI

### 24.1 Teacher Dashboard

Required sections:

- Classes overview.
- Recent student activity.
- Assignments due.
- Materials processing.
- Weak topics across class.
- Suggested interventions.

### 24.2 Class Detail

- Students.
- Materials.
- Assignments.
- Quiz performance.
- Topic mastery heatmap.
- Export/report.

### 24.3 Assignment Creation

Teacher can:

- Select document/course.
- Select generated quiz/checkpoints.
- Set due date.
- Set attempt rules.
- Publish to class.

### 24.4 Student Progress

- Individual student profile.
- Attempt history.
- Weak topics.
- Review activity.
- Missing assignments.

Teacher UI must be clearly separated from learner UI but share visual system.

---

## 25. Admin / Operator UI

### 25.1 Admin Overview

- Active users.
- Documents processed.
- Failed jobs.
- AI cost today/month.
- Credit revenue.
- Abuse/moderation queue.
- System health.

### 25.2 Job Monitoring

- Job list.
- Status filter.
- Pipeline step.
- Error reason.
- Retry action.
- Correlation ID.
- Owner/user.
- Cost estimate/actual.

### 25.3 AI Cost Dashboard

- Cost by provider/model.
- Cost by feature: quiz, tutor, STT, embedding.
- Cache hit rate.
- Top expensive users/documents.
- Circuit breaker state.

### 25.4 Moderation

- Flagged files.
- Suspicious usage.
- Malware/upload verification failures.
- User restrictions.

### 25.5 Support View

- User lookup.
- Document/job history.
- Billing status.
- Safe impersonation or support link if supported.
- Audit log.

### 25.6 Custom AI Feature Setting

- Admin can only view and toggle the global `customAiEnabled` setting.
- The toggle requires a confirmation explaining that new create/edit/verify/select/confirm/retry actions will be blocked while running attempts continue.
- Show audit history with actor, previous value, new value, and timestamp.
- Admin must not have UI access to Owner endpoints, models, API keys, or configuration management.
- Job monitoring and cost dashboards may show aggregate provider category and safe operational metadata, but must not reveal an Owner's Custom AI base URL, model configuration, secret metadata, or credential state.

---

## 26. Global States And Feedback

### 26.1 Loading States

Required patterns:

- Skeletons for dashboards/lists.
- Step progress for processing.
- Spinner only when short and label is visible.
- Never show unlabeled loading indicators.

### 26.2 Empty States

Every major page needs an empty state:

- Home no documents.
- Library empty.
- Review no due cards.
- Analytics no attempts.
- Tutor no document context.
- Course no documents.
- Billing no invoices.

Empty states should include:

- What this page is for.
- Why it is empty.
- Primary action.
- Optional sample/demo.

### 26.3 Error States

Errors should be specific:

- Upload failed.
- File unsupported.
- Verification failed.
- Processing failed.
- AI output invalid.
- Not enough credits.
- Access denied / not found.
- Network disconnected.

Each error should include:

- Human-readable message.
- Recovery action.
- Support/report option if unrecoverable.
- Stable error code and retryability where applicable.
- `404` is reserved for a Document that does not exist or is not owned by the current Owner. Quiz not ready and processing failed are `409` states with different recovery actions.
- `QUIZ_INVARIANT_VIOLATION` must show a system-error message with `traceId` and a support/report action; it must not offer a normal processing retry without operator diagnosis.

### 26.4 Success States

Success states:

- Upload complete.
- Document ready.
- Quiz submitted.
- Review completed.
- Plan upgraded.

Use concise success feedback and direct next action.

---

## 27. Accessibility Requirements

Non-negotiables:

- Keyboard works everywhere.
- Focus is visible everywhere.
- Links are links; buttons are buttons.
- All controls have labels.
- Icon-only buttons have accessible names.
- Hidden UI is not tabbable.
- Mobile tap targets are large enough.
- Reduced-motion users get reduced motion.
- Charts have text summaries.
- Color is not the only carrier of meaning.
- Forms have inline errors near fields.
- Dialogs trap focus and close with Escape.
- Video must support captions/transcript when available.

Quiz accessibility:

- Radio options must be properly grouped.
- Selected option is announced.
- Progress is announced.
- Result correctness is accessible without color reliance.

Tutor accessibility:

- New messages should be announced politely.
- Streaming answer should not steal focus.
- Citations must be keyboard reachable.

---

## 28. Responsive Requirements

### 28.1 Desktop

Desktop should support:

- Sidebars.
- Split source/question view.
- Source + tutor side-by-side.
- Data-rich analytics.
- Teacher/admin tables.

### 28.2 Tablet

- Collapsible sidebars.
- Two-column where possible.
- Larger touch targets.
- Video checkpoint overlay optimized for landscape and portrait.

### 28.3 Mobile

Mobile should prioritize:

- Review queue.
- Quiz attempts.
- Flashcards.
- Notifications.
- Document status.
- Tutor chat.

Mobile patterns:

- Bottom navigation for learner app.
- Sticky primary actions.
- Full-screen source viewer when needed.
- Bottom sheets for filters/citations.
- Avoid horizontal overflow.
- Long Vietnamese text must wrap gracefully.

---

## 29. Content And Copy Requirements

Tone:

- Direct, encouraging, trustworthy.
- Avoid hype like “perfect AI”.
- Be transparent when AI may be wrong.
- Use learning language: review, recall, mastery, source, explanation.

Preferred terms:

- Document, not File/Asset/Material in domain UI when referring to learning material.
- Quiz, Question, Attempt, Review, Checkpoint, Tutor.
- Source citation / Citation.
- Processing, Ready, Failed.

Avoid:

- “Magic”.
- “Guaranteed correct”.
- “AI knows everything”.
- Ambiguous “Generate” buttons without explaining what will be generated.

Important microcopy examples:

```text
Your quiz is grounded in this document. Each explanation links back to the source.
```

```text
We could not find enough source evidence to answer confidently.
```

```text
Processing can take a few minutes. You can leave this page; we’ll notify you when it’s ready.
```

---

## 30. Security, Privacy, And Trust UI

The UI must communicate:

- Uploaded documents are private by default.
- Users control deletion.
- AI-generated outputs can be wrong and should be checked with citations.
- File limits and allowed types.
- Suspicious/unsafe file handling if upload rejected.
- Billing/credit usage before expensive processing.

Trust surfaces:

- Citation badges.
- Source snippets.
- Processing transparency.
- Data privacy settings.
- Usage/cost transparency.

---

## 31. Screen Inventory

Generate designs for at least these screens:

Public:

- Landing page.
- Product/features page.
- Pricing page.
- Example/demo gallery.
- FAQ/help landing.

Auth/onboarding:

- Sign up.
- Login.
- Forgot/reset password.
- Email verification.
- First-time onboarding.
- Empty first-run dashboard.

Learner app:

- Home dashboard.
- Upload screen.
- Upload preflight/confirmation.
- Processing progress page.
- Library list/grid.
- Document detail for PDF/text.
- Document detail for video.
- Source viewer with citation highlight.
- Quiz start.
- Quiz question.
- Quiz submit confirmation.
- Quiz result summary.
- Per-question review.
- Video player with checkpoint overlay.
- Flashcard deck.
- Flashcard review.
- Review queue.
- AI Tutor global.
- AI Tutor with document context.
- Courses list.
- Course detail.
- Analytics dashboard.
- Weak topic detail.
- Study plan.
- Exam setup.
- Practice exam.
- Practice exam result.
- Notifications.
- Billing/usage.
- Plan upgrade.
- Settings.

Teacher:

- Teacher dashboard.
- Class list.
- Class detail.
- Assignment creation.
- Student progress detail.

Admin:

- Admin overview.
- Job monitoring.
- AI cost dashboard.
- User/support lookup.
- Moderation queue.

Error/system:

- 404.
- Access denied.
- Network/offline.
- Processing failed.
- Not enough credits.
- Maintenance/system issue.

---

## 32. Critical User Flows To Design End-To-End

### 32.1 First Value Flow

```text
Landing -> Sign up -> Onboarding -> Upload PDF -> Processing -> Quiz ready -> Start quiz -> Submit -> Result with citations
```

### 32.2 Returning Learner Flow

```text
Login -> Home -> Review queue -> Flashcard/quiz review -> Weak topic -> Source explanation -> Mark review complete
```

### 32.3 Video Checkpoint Flow

```text
Upload video -> Processing/STT -> Video ready -> Watch -> Auto-pause checkpoint -> Answer -> Feedback -> Continue
```

### 32.4 Tutor Flow

```text
Open document -> Ask Tutor -> Receive cited answer -> Jump to source -> Generate follow-up quiz/flashcards
```

### 32.5 Paid Conversion Flow

```text
User reaches credit/file/video limit -> Exact limit explanation -> Choose Custom AI or smaller input -> Compare plans/top up if preferred -> Continue processing without re-upload
```

### 32.6 Recoverable Processing Failure Flow

```text
Document processing fails -> Show safe reason and retryability -> Change Platform Model or choose verified Custom AI -> Confirm retry -> New processing attempt -> Quiz ready
```

### 32.7 Teacher Flow

```text
Create class -> Upload material -> Generate quiz -> Assign to students -> View progress -> Identify weak topics
```

---

## 33. Design Generator Instructions

When generating UI:

- Produce a coherent design system, not isolated screens.
- Include desktop and mobile variants for learner-critical flows.
- Include empty, loading, error, success, and dense states.
- Show real Vietnamese-capable content examples, not only short English placeholders.
- Make citations visible in quiz/tutor/results.
- Show AI processing as a transparent pipeline, not a vague spinner.
- Make “next best action” clear on every learner page.
- Avoid exposing correct answers before submission.
- Use realistic long document names and course names.
- Include credit/cost warnings in upload and billing flows.
- Do not route an `UPLOADED`, `PROCESSING`, or `FAILED` Document into a generic Quiz 404 screen.
- Include Custom AI Settings for Owners and only a global enable/disable setting for Admin.
- Use accessible controls and visible focus states.

Recommended sample content:

```text
Document: Nhập môn Hệ điều hành — Chương 3: Quản lý tiến trình.pdf
Course: Ôn thi cuối kỳ Hệ điều hành
Question: Vì sao context switching tạo overhead cho hệ thống?
Citation: Trang 12, đoạn “Context switch requires saving and restoring process state…”
Weak topic: Đồng bộ tiến trình
```

---

## 34. MVP vs Production Priority

If designing all screens is too much, prioritize in this order:

1. Landing page.
2. Sign up/onboarding.
3. Learner dashboard.
4. Upload flow.
5. Processing progress.
6. Library.
7. Document detail.
8. Quiz start/question/result/review.
9. Tutor with citations.
10. Billing/usage limits.
11. Video checkpoint.
12. Flashcards/review queue.
13. Analytics/weak topics.
14. Courses.
15. Teacher/classroom.
16. Admin/operator.

For the first production launch, the strongest wedge is:

```text
PDF/text -> grounded quiz -> attempt -> result with citation -> review weak areas
```

The UI should still be designed with future video, tutor, analytics, and classroom surfaces in mind.
