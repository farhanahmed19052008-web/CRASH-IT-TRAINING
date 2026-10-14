/* LLS Crash IT Training Program portal
   Frontend starter. Security is enforced by Supabase Auth + database RLS policies in schema.sql.
   NEVER add a Supabase service_role key to browser code. */
(() => {
  "use strict";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const PASS_MARK = Number(window.LLS_CONFIG?.PASS_MARK_PERCENT || 50);
  const CONFIG_KEY = "lls_supabase_config";
  let supabaseClient = null;
  let session = null;
  let profile = null;
  let activeRole = "student";
  let activeView = "overview";
  let linkedStudentIds = [];
  let toastTimer = null;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
  const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
  const isoToday = () => new Date().toLocaleDateString("en-CA");
  const monthNow = () => isoToday().slice(0,7);
  const startOfMonth = (month) => `${month}-01`;
  const endOfMonth = (month) => {
    const [y,m] = month.split("-").map(Number);
    return new Date(y,m,0).toLocaleDateString("en-CA");
  };
  const showToast = (message, error = false) => {
    const node = $("#toast");
    node.textContent = message;
    node.classList.toggle("error", error);
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 3500);
  };
  const setDashMessage = (message = "") => { $("#dashMessage").textContent = message; };
  const dbError = (error, context = "Request failed") => {
    console.error(context, error);
    const message = error?.message || context;
    setDashMessage(`${context}: ${message}`);
    showToast(message, true);
  };
  const config = () => {
    if (window.LLS_CONFIG?.SUPABASE_URL && window.LLS_CONFIG?.SUPABASE_ANON_KEY &&
        !window.LLS_CONFIG.SUPABASE_URL.includes("YOUR_PROJECT") &&
        !window.LLS_CONFIG.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) return window.LLS_CONFIG;
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); } catch { return null; }
  };
  const getClient = () => {
    if (supabaseClient) return supabaseClient;
    const cfg = config();
    if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY) return null;
    if (!window.supabase?.createClient) return null;
    supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return supabaseClient;
  };
  const isStaff = () => ["teacher","admin"].includes(profile?.role);
  const isAdmin = () => profile?.role === "admin";
  const roleName = (role) => ({student:"Student",parent:"Parent",teacher:"Teacher",admin:"Administrator"}[role] || "Account");
  const openAuth = (role = "student") => {
    activeRole = role;
    $$(".role-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.role === role));
    $("#authModal").classList.add("open");
    $("#authModal").setAttribute("aria-hidden","false");
    $("#loginMessage").textContent = "";
    setTimeout(() => $("#loginEmail").focus(), 50);
  };
  const closeAuth = () => {
    $("#authModal").classList.remove("open");
    $("#authModal").setAttribute("aria-hidden","true");
  };
  const setLoggedInUI = () => {
    $("#authModal").classList.remove("open");
    $("#appShell").classList.remove("hidden");
    document.body.classList.add("portal-mode");
    $("#userName").textContent = profile?.full_name || session?.user?.email || "LLS user";
    $("#userRole").textContent = roleName(profile?.role);
    $("#userAvatar").textContent = (profile?.full_name || session?.user?.email || "L").slice(0,1).toUpperCase();
    $$(".staff-only").forEach(el => el.classList.toggle("hidden", !isStaff()));
    $("#dashEyebrow").textContent = `${roleName(profile?.role).toUpperCase()} DASHBOARD`;
    $("#todayChip").textContent = new Date().toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
    $("#dashTitle").textContent = isStaff() ? "Your learning program, at a glance." : `Welcome, ${(profile?.full_name || "learner").split(" ")[0]}.`;
    $("#dashSubtitle").textContent = isStaff() ? "Manage records, attendance and assessments." : "Keep learning, keep growing.";
    $$(".topbar, main, .stats-strip, .footer").forEach(el => el.classList.add("hidden"));
    window.scrollTo({top:0,behavior:"smooth"});
  };
  const setLoggedOutUI = () => {
    $("#appShell").classList.add("hidden");
    $$(".topbar, main, .stats-strip, .footer").forEach(el => el.classList.remove("hidden"));
    document.body.classList.remove("portal-mode");
  };
  const fetchProfile = async () => {
    const {data,error} = await supabaseClient.from("profiles").select("id, full_name, role, email").eq("id",session.user.id).single();
    if (error) throw error;
    profile = data;
    if (!profile?.role) throw new Error("Your profile has no role. Ask the administrator to configure your account.");
    const {data: links, error: linkError} = await supabaseClient.from("parent_students").select("student_id").eq("parent_id",session.user.id);
    if (linkError) throw linkError;
    linkedStudentIds = (links || []).map(x => x.student_id);
  };
  const query = async (promise, context) => {
    const {data,error} = await promise;
    if (error) { dbError(error,context); throw error; }
    return data;
  };
  const setView = async (view) => {
    activeView = view;
    $$(".side-link").forEach(btn => btn.classList.toggle("active",btn.dataset.view === view));
    $$(".dashboard-view").forEach(el => el.classList.toggle("hidden",el.id !== `view-${view}`));
    const titles = {
      overview:["Your progress, at a glance.","A snapshot of learning and activity."],
      attendance:["Attendance records.","Review attendance by day and month."],
      quizzes:["Quizzes and grand tests.","Practice, take assessments and review results."],
      progress:["Progress reports.","Attendance and assessment performance in one place."],
      students:["Student directory.","Create and manage learner profiles."],
      "mark-attendance":["Mark daily attendance.","Record today's attendance for your class."],
      "manage-quizzes":["Assessment manager.","Create weekly quizzes and monthly grand tests."]
    };
    $("#dashTitle").textContent = titles[view]?.[0] || "Dashboard";
    $("#dashSubtitle").textContent = titles[view]?.[1] || "";
    setDashMessage("");
    try {
      if (view === "overview") await renderOverview();
      if (view === "attendance") await renderAttendance();
      if (view === "quizzes") await renderQuizzes();
      if (view === "progress") await renderProgress();
      if (view === "students") await renderStudents();
      if (view === "mark-attendance") await renderMarkAttendance();
      if (view === "manage-quizzes") await renderManageQuizzes();
    } catch (error) { console.error(error); }
  };
  const getVisibleStudents = async () => {
    if (isStaff()) return query(supabaseClient.from("students").select("id, roll_number, full_name, class_level, active").order("roll_number"),"Could not load students");
    if (profile?.role === "student") {
      const rows = await query(supabaseClient.from("students").select("id, roll_number, full_name, class_level, active").eq("profile_id",session.user.id),"Could not load your student profile");
      return rows || [];
    }
    if (profile?.role === "parent") {
      if (!linkedStudentIds.length) return [];
      return query(supabaseClient.from("students").select("id, roll_number, full_name, class_level, active").in("id",linkedStudentIds),"Could not load linked students");
    }
    return [];
  };
  const getSelectedStudentIds = async () => {
    const students = await getVisibleStudents();
    return students.map(s => s.id);
  };
  const studentNameMap = (students) => Object.fromEntries(students.map(s => [s.id, `${s.full_name} (${s.roll_number})`]));
  const badge = (value) => `<span class="pill ${escapeHtml(String(value).toLowerCase())}">${escapeHtml(value)}</span>`;
  const empty = (message) => `<div class="empty-state">${escapeHtml(message)}</div>`;
  const panel = (title, body, subtitle = "") => `<article class="panel-card"><div class="panel-title"><div><h2>${escapeHtml(title)}</h2>${subtitle?`<p>${escapeHtml(subtitle)}</p>`:""}</div></div>${body}</article>`;
  const metric = (title, value, caption, icon) => `<article class="metric-card"><div class="metric-top"><span>${escapeHtml(title)}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${escapeHtml(value)}</div><div class="metric-caption">${escapeHtml(caption)}</div></article>`;
  const studentSelect = (students, name = "student_id", first = "Choose a student") => `<select name="${name}" required><option value="">${escapeHtml(first)}</option>${students.map(s=>`<option value="${s.id}">${escapeHtml(s.roll_number)} — ${escapeHtml(s.full_name)} (${escapeHtml(s.class_level)})</option>`).join("")}</select>`;
  const renderOverview = async () => {
    const students = await getVisibleStudents();
    const ids = students.map(s=>s.id);
    const [attendance, attempts, assessments] = await Promise.all([
      ids.length ? query(supabaseClient.from("attendance").select("id, student_id, attendance_date, status").in("student_id",ids).gte("attendance_date",startOfMonth(monthNow())).lte("attendance_date",endOfMonth(monthNow())),"Could not load attendance") : [],
      ids.length ? query(supabaseClient.from("quiz_attempts").select("id, assessment_id, student_id, score_percent, passed, submitted_at, assessments(title,subject)").in("student_id",ids).order("submitted_at",{ascending:false}).limit(8),"Could not load quiz attempts") : [],
      query(supabaseClient.from("assessments").select("id, title, subject, assessment_type, published, due_date").eq("published",true).order("created_at",{ascending:false}).limit(5),"Could not load assessments")
    ]);
    const present = attendance.filter(a=>a.status==="present").length;
    const total = attendance.length;
    const average = attempts.length ? Math.round(attempts.reduce((sum,a)=>sum+Number(a.score_percent||0),0)/attempts.length) : 0;
    const passed = attempts.filter(a=>a.passed).length;
    const isLearner = !isStaff();
    let html = `<div class="metric-grid">${isStaff()?metric("Active students",students.filter(s=>s.active).length,"Learner records","♙"):metric("My students",students.length,"Linked student profile(s)","♙")}${metric("Attendance this month",total?`${Math.round(present/total*100)}%`:"—",`${present} present marks recorded`,"◷")}${metric("Quiz average",attempts.length?`${average}%`:"—",`${attempts.length} recent attempt(s)`,"⌘")}${metric("Quizzes passed",attempts.length?`${passed}/${attempts.length}`:"—",`Pass threshold: ${PASS_MARK}%`,"✓")}</div>`;
    const recentRows = attempts.map(a=>`<tr><td>${escapeHtml(a.assessments?.title || "Assessment")}</td><td>${escapeHtml(a.assessments?.subject || "—")}</td><td>${Math.round(Number(a.score_percent||0))}%</td><td>${badge(a.passed?"Passed":"Failed")}</td><td>${a.submitted_at?fmtDate(a.submitted_at.slice(0,10)):"—"}</td></tr>`).join("");
    const assessmentsRows = assessments.map(a=>`<tr><td>${escapeHtml(a.title)}</td><td>${escapeHtml(a.subject)}</td><td>${escapeHtml(a.assessment_type.replace("_"," "))}</td><td>${a.due_date?fmtDate(a.due_date):"No due date"}</td></tr>`).join("");
    html += `<div class="dash-columns">${panel("Recent assessment results",recentRows?`<div class="data-table-wrap"><table><thead><tr><th>Assessment</th><th>Subject</th><th>Score</th><th>Result</th><th>Date</th></tr></thead><tbody>${recentRows}</tbody></table></div>`:empty("No quiz attempts yet."),"Latest submitted results")}${panel("Published assessments",assessmentsRows?`<div class="data-table-wrap"><table><thead><tr><th>Assessment</th><th>Subject</th><th>Type</th><th>Due</th></tr></thead><tbody>${assessmentsRows}</tbody></table></div>`:empty("No assessments are published yet."),"Available learning activities")}</div>`;
    if (isStaff()) html += `<div class="action-row no-print"><button class="button button-blue" data-go="mark-attendance">✓ Mark attendance</button><button class="button button-muted" data-go="students">＋ Add student</button><button class="button button-muted" data-go="manage-quizzes">＋ Create assessment</button></div>`;
    $("#view-overview").innerHTML = html;
    bindViewActions();
  };
  const renderAttendance = async () => {
    const students = await getVisibleStudents();
    const ids = students.map(s=>s.id);
    const body = `<div class="action-row no-print" style="margin-bottom:16px"><div class="field"><label for="attendanceMonth">Report month</label><input id="attendanceMonth" type="month" value="${monthNow()}"></div><button class="button button-blue" id="loadAttendance">Load report</button><button class="button button-muted" id="printAttendance">Print / Save PDF</button></div><div id="attendanceReport">${empty("Choose a month and load attendance.")}</div>`;
    $("#view-attendance").innerHTML = panel("Attendance report",body,"Daily records and monthly summary");
    $("#loadAttendance").addEventListener("click",()=>loadAttendanceReport(students));
    $("#printAttendance").addEventListener("click",()=>window.print());
    if (ids.length) await loadAttendanceReport(students);
  };
  const loadAttendanceReport = async (students) => {
    const month = $("#attendanceMonth")?.value || monthNow();
    const ids = students.map(s=>s.id);
    if (!ids.length) { $("#attendanceReport").innerHTML=empty("No student profile is linked to this account.");return; }
    const rows = await query(supabaseClient.from("attendance").select("id,student_id,attendance_date,status,notes").in("student_id",ids).gte("attendance_date",startOfMonth(month)).lte("attendance_date",endOfMonth(month)).order("attendance_date",{ascending:false}),"Could not load attendance report");
    const names=studentNameMap(students);
    const byStudent = students.map(s=>{
      const sr=rows.filter(r=>r.student_id===s.id);
      const present=sr.filter(r=>r.status==="present").length;
      const absent=sr.filter(r=>r.status==="absent").length;
      const late=sr.filter(r=>r.status==="late").length;
      const counted=present+absent+late;
      return `<tr><td>${escapeHtml(s.full_name)}</td><td>${escapeHtml(s.roll_number)}</td><td>${present}</td><td>${absent}</td><td>${late}</td><td>${counted?Math.round(present/counted*100):0}%</td></tr>`;
    }).join("");
    const detailRows=rows.map(r=>`<tr><td>${escapeHtml(names[r.student_id]||"Student")}</td><td>${fmtDate(r.attendance_date)}</td><td>${badge(r.status)}</td><td>${escapeHtml(r.notes||"—")}</td></tr>`).join("");
    $("#attendanceReport").innerHTML = `<div class="report-head"><div><h2>LLS Crash IT Training Program</h2><div class="report-meta">Monthly attendance slip · ${escapeHtml(month)}</div></div><div class="report-meta">Generated ${fmtDate(isoToday())}</div></div><div class="report-numbers"><div class="report-number"><strong>${rows.filter(r=>r.status==="present").length}</strong><span>Present marks</span></div><div class="report-number"><strong>${rows.filter(r=>r.status==="absent").length}</strong><span>Absences</span></div><div class="report-number"><strong>${rows.filter(r=>r.status==="late").length}</strong><span>Late arrivals</span></div></div><h3>Student summary</h3><div class="data-table-wrap"><table><thead><tr><th>Student</th><th>Roll no.</th><th>Present</th><th>Absent</th><th>Late</th><th>Attendance %</th></tr></thead><tbody>${byStudent}</tbody></table></div><h3 style="margin-top:26px">Daily detail</h3><div class="data-table-wrap"><table><thead><tr><th>Student</th><th>Date</th><th>Status</th><th>Notes</th></tr></thead><tbody>${detailRows||`<tr><td colspan="4">No records for this month.</td></tr>`}</tbody></table></div>`;
  };
  const renderQuizzes = async () => {
    const students = await getVisibleStudents();
    const ids = students.map(s=>s.id);
    const assessments = await query(supabaseClient.from("assessments").select("id,title,description,subject,assessment_type,due_date,questions,published,pass_mark_percent").eq("published",true).order("created_at",{ascending:false}),"Could not load assessments");
    const attempts = ids.length ? await query(supabaseClient.from("quiz_attempts").select("id,assessment_id,student_id,score_percent,passed,submitted_at").in("student_id",ids).order("submitted_at",{ascending:false}),"Could not load results") : [];
    const names=studentNameMap(students);
    const attemptMap = {};
    attempts.forEach(a => { if (!attemptMap[a.assessment_id]) attemptMap[a.assessment_id]=[]; attemptMap[a.assessment_id].push(a); });
    let html = `<div class="inline-note">Weekly quizzes and monthly grand tests appear here after a teacher or administrator publishes them. Results are saved to your account.</div>`;
    if (!assessments.length) html += panel("Available assessments",empty("No published quizzes or tests yet."));
    for (const a of assessments) {
      const myAttempt = attemptMap[a.id]?.find(x=>x.student_id===session.user.id) || (profile.role==="student"?attemptMap[a.id]?.[0]:null);
      const attemptCount = attemptMap[a.id]?.length || 0;
      const questions = Array.isArray(a.questions)?a.questions:[];
      html += `<article class="panel-card quiz-card"><div class="panel-title"><div><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.subject)} · ${escapeHtml(a.assessment_type.replace("_"," "))}${a.due_date?` · Due ${fmtDate(a.due_date)}`:""}</p></div>${myAttempt?badge(myAttempt.passed?"Passed":"Failed"):`<span class="pill neutral">${questions.length} questions</span>`}</div><p>${escapeHtml(a.description||"Assessment from LLS Crash IT Training Program.")}</p>${myAttempt?`<p><strong>Latest score:</strong> ${Math.round(myAttempt.score_percent)}% · ${myAttempt.passed?"Pass":"Needs more practice"}</p>`:profile.role==="student"?`<button class="button button-blue" data-take-quiz="${a.id}">Start assessment →</button>`:isStaff()?`<span class="subtle">${attemptCount} attempt(s) submitted</span>`:`<span class="subtle">Ask the student to sign in to take this assessment.</span>`}</article>`;
    }
    $("#view-quizzes").innerHTML = html;
    $$("[data-take-quiz]").forEach(btn=>btn.addEventListener("click",()=>startQuiz(assessments.find(a=>a.id===btn.dataset.takeQuiz))));
  };
  const startQuiz = (assessment) => {
    if (!assessment) return;
    const questions = Array.isArray(assessment.questions)?assessment.questions:[];
    if (!questions.length) { showToast("This assessment has no questions yet.",true); return; }
    const view=$("#view-quizzes");
    view.innerHTML = `<article class="panel-card"><div class="panel-title"><div><h2>${escapeHtml(assessment.title)}</h2><p>${escapeHtml(assessment.subject)} · Pass mark ${assessment.pass_mark_percent ?? PASS_MARK}%</p></div><span class="pill neutral">${questions.length} questions</span></div><form id="quizForm">${questions.map((q,i)=>`<fieldset class="quiz-question"><h4>${i+1}. ${escapeHtml(q.question)}</h4>${(q.options||[]).map((opt,j)=>`<label class="option-label"><input type="radio" name="q${i}" value="${j}" required><span>${escapeHtml(opt)}</span></label>`).join("")}</fieldset>`).join("")}<div class="form-actions"><button class="button button-blue" type="submit">Submit answers</button><button class="button button-muted" type="button" id="cancelQuiz">Cancel</button></div></form></article>`;
    $("#cancelQuiz").addEventListener("click",()=>setView("quizzes"));
    $("#quizForm").addEventListener("submit",async (event)=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      let correct=0;
      questions.forEach((q,i)=>{if(Number(form.get(`q${i}`))===Number(q.answer_index))correct++;});
      const score=Math.round(correct/questions.length*100);
      const passed=score>=Number(assessment.pass_mark_percent??PASS_MARK);
      const {error}=await supabaseClient.from("quiz_attempts").insert({assessment_id:assessment.id,student_id:session.user.id,answers:Object.fromEntries(questions.map((q,i)=>[`q${i}`,Number(form.get(`q${i}`))])),correct_answers:correct,total_questions:questions.length,score_percent:score,passed});
      if(error){dbError(error,"Could not save your result");return;}
      view.innerHTML=`<article class="panel-card"><div class="eyebrow dark-eyebrow">ASSESSMENT COMPLETE</div><h2 style="font:700 2rem var(--display)">${score}%</h2><p>${correct} of ${questions.length} answers correct.</p>${badge(passed?"Passed":"Failed")}<p>${passed?"Great work — keep it up!":"Review the topics and keep practicing."}</p><button class="button button-blue" id="backQuizzes">Back to assessments</button></article>`;
      $("#backQuizzes").addEventListener("click",()=>setView("quizzes"));
    });
  };
  const renderProgress = async () => {
    const students=await getVisibleStudents();
    const ids=students.map(s=>s.id);
    const [attendance,attempts]=await Promise.all([
      ids.length?query(supabaseClient.from("attendance").select("student_id,status,attendance_date").in("student_id",ids),"Could not load attendance"):[],
      ids.length?query(supabaseClient.from("quiz_attempts").select("student_id,assessment_id,score_percent,passed,submitted_at").in("student_id",ids).order("submitted_at",{ascending:false}),"Could not load quiz results"):[]
    ]);
    const names=studentNameMap(students);
    const rows=students.map(s=>{
      const sa=attendance.filter(a=>a.student_id===s.id), sr=attempts.filter(a=>a.student_id===s.id);
      const counted=sa.filter(a=>["present","absent","late"].includes(a.status)).length;
      const present=sa.filter(a=>a.status==="present").length;
      const avg=sr.length?Math.round(sr.reduce((sum,a)=>sum+Number(a.score_percent||0),0)/sr.length):0;
      return `<tr><td>${escapeHtml(s.full_name)}</td><td>${escapeHtml(s.roll_number)}</td><td>${counted?Math.round(present/counted*100):0}%</td><td>${sr.length?avg+"%":"—"}</td><td>${sr.filter(a=>a.passed).length}/${sr.length}</td><td><div class="progress-track"><div class="progress-fill" style="width:${avg}%"></div></div></td></tr>`;
    }).join("");
    const html = `<div class="panel-card"><div class="report-head"><div><h2>Progress report</h2><div class="report-meta">LLS Crash IT Training Program · ${fmtDate(isoToday())}</div></div><button class="button button-blue no-print" id="printProgress">Print / Save PDF</button></div><div class="report-numbers"><div class="report-number"><strong>${students.length}</strong><span>Student profile(s)</span></div><div class="report-number"><strong>${attendance.filter(a=>a.status==="present").length}</strong><span>Present records</span></div><div class="report-number"><strong>${attempts.length}</strong><span>Assessment attempts</span></div></div><div class="data-table-wrap"><table><thead><tr><th>Student</th><th>Roll no.</th><th>Attendance</th><th>Average</th><th>Passed</th><th>Score trend</th></tr></thead><tbody>${rows||`<tr><td colspan="6">No student records available.</td></tr>`}</tbody></table></div></div>`;
    $("#view-progress").innerHTML=html;
    $("#printProgress").addEventListener("click",()=>window.print());
  };
  const renderStudents = async () => {
    if(!isStaff())return;
    const students=await getVisibleStudents();
    const rows=students.map(s=>`<tr><td>${escapeHtml(s.roll_number)}</td><td>${escapeHtml(s.full_name)}</td><td>${escapeHtml(s.class_level)}</td><td>${badge(s.active?"Active":"Inactive")}</td></tr>`).join("");
    $("#view-students").innerHTML=`${panel("Add a student",`<form id="studentForm" class="form-grid"><div class="field"><label>Full name</label><input name="full_name" required maxlength="120"></div><div class="field"><label>Roll number</label><input name="roll_number" required maxlength="40"></div><div class="field"><label>Class</label><select name="class_level"><option>9th</option><option>10th</option></select></div><div class="field"><label>Student login user ID (optional)</label><input name="profile_id" placeholder="Auth user UUID"></div><div class="field full"><div class="inline-note">Create the student's Auth account first in Supabase Authentication. Paste that user's UUID to link login access. Never share the service-role key.</div></div><div class="field full"><button class="button button-blue" type="submit">Save student profile</button></div></form>`,"Admin / teacher entry")}${panel("Student directory",rows?`<div class="data-table-wrap"><table><thead><tr><th>Roll no.</th><th>Name</th><th>Class</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty("No students added yet."),`${students.length} profile(s)`)}`;
    $("#studentForm").addEventListener("submit",async e=>{
      e.preventDefault();const fd=new FormData(e.currentTarget);
      const payload={full_name:String(fd.get("full_name")).trim(),roll_number:String(fd.get("roll_number")).trim(),class_level:String(fd.get("class_level")),active:true};
      const profileId=String(fd.get("profile_id")||"").trim();if(profileId)payload.profile_id=profileId;
      const {error}=await supabaseClient.from("students").insert(payload);
      if(error){dbError(error,"Could not save student");return;}
      showToast("Student profile saved.");await renderStudents();
    });
  };
  const renderMarkAttendance = async () => {
    if(!isStaff())return;
    const students=await getVisibleStudents();
    $("#view-mark-attendance").innerHTML=panel("Record daily attendance",`<form id="attendanceForm"><div class="form-grid"><div class="field"><label>Date</label><input type="date" name="attendance_date" value="${isoToday()}" required></div><div class="field"><label>Student</label>${studentSelect(students)}</div><div class="field"><label>Status</label><select name="status"><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option></select></div><div class="field"><label>Note (optional)</label><input name="notes" maxlength="250" placeholder="Optional note"></div></div><div class="form-actions"><button class="button button-blue" type="submit">Save attendance</button></div></form><div class="inline-note" style="margin-top:18px">One attendance record is allowed per student per date. Saving again updates that day's status.</div>`,"Teacher and administrator access");
    $("#attendanceForm").addEventListener("submit",async e=>{
      e.preventDefault();const fd=new FormData(e.currentTarget);
      const record={student_id:fd.get("student_id"),attendance_date:fd.get("attendance_date"),status:fd.get("status"),notes:String(fd.get("notes")||"").trim(),marked_by:session.user.id};
      const {error}=await supabaseClient.from("attendance").upsert(record,{onConflict:"student_id,attendance_date"});
      if(error){dbError(error,"Could not save attendance");return;}
      showToast("Attendance saved.");e.currentTarget.reset();$('input[name="attendance_date"]',e.currentTarget).value=isoToday();
    });
  };
  const renderManageQuizzes = async () => {
    if(!isStaff())return;
    const assessments=await query(supabaseClient.from("assessments").select("id,title,subject,assessment_type,published,due_date").order("created_at",{ascending:false}),"Could not load assessments");
    const rows=assessments.map(a=>`<tr><td>${escapeHtml(a.title)}</td><td>${escapeHtml(a.subject)}</td><td>${escapeHtml(a.assessment_type.replace("_"," "))}</td><td>${badge(a.published?"Published":"Draft")}</td><td>${a.due_date?fmtDate(a.due_date):"—"}</td></tr>`).join("");
    const example=JSON.stringify([{question:"What does print() do in Python?",options:["Displays output","Repeats a loop","Defines a class","Imports a module"],answer_index:0},{question:"Which keyword defines a function in Python?",options:["func","define","def","method"],answer_index:2}],null,2);
    $("#view-manage-quizzes").innerHTML=`${panel("Create an assessment",`<form id="assessmentForm" class="form-grid"><div class="field"><label>Assessment title</label><input name="title" required maxlength="160" placeholder="Week 1 Python Quiz"></div><div class="field"><label>Subject</label><select name="subject"><option>Python</option><option>Java</option><option>CSP</option></select></div><div class="field"><label>Assessment type</label><select name="assessment_type"><option value="weekly_quiz">Weekly quiz</option><option value="grand_test">Monthly grand test</option></select></div><div class="field"><label>Due date (optional)</label><input type="date" name="due_date"></div><div class="field"><label>Pass mark (%)</label><input type="number" name="pass_mark_percent" min="1" max="100" value="${PASS_MARK}" required></div><div class="field"><label>Publish now?</label><select name="published"><option value="true">Yes — visible to students</option><option value="false">No — keep as draft</option></select></div><div class="field full"><label>Description</label><input name="description" maxlength="500" placeholder="Topics covered in this assessment"></div><div class="field full"><label>Questions JSON</label><textarea name="questions" required spellcheck="false">${escapeHtml(example)}</textarea><small class="subtle">Each question needs question, options (array), and answer_index (zero-based). Do not include sensitive data.</small></div><div class="field full"><button class="button button-blue" type="submit">Save assessment</button></div></form>`,"Weekly quizzes and monthly grand tests")}${panel("Assessment list",rows?`<div class="data-table-wrap"><table><thead><tr><th>Title</th><th>Subject</th><th>Type</th><th>Status</th><th>Due date</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty("No assessments created yet."),`${assessments.length} assessment(s)`)}`;
    $("#assessmentForm").addEventListener("submit",async e=>{
      e.preventDefault();const fd=new FormData(e.currentTarget);let questions;
      try{questions=JSON.parse(String(fd.get("questions")));if(!Array.isArray(questions)||!questions.length)throw new Error("Questions must be a non-empty JSON array.");for(const q of questions){if(typeof q.question!=="string"||!Array.isArray(q.options)||q.options.length<2||!Number.isInteger(Number(q.answer_index))||Number(q.answer_index)<0||Number(q.answer_index)>=q.options.length)throw new Error("Each question must include question, at least two options, and a valid answer_index.");}}catch(err){showToast(`Invalid questions: ${err.message}`,true);return;}
      const payload={title:String(fd.get("title")).trim(),subject:String(fd.get("subject")),assessment_type:String(fd.get("assessment_type")),due_date:fd.get("due_date")||null,pass_mark_percent:Number(fd.get("pass_mark_percent")),description:String(fd.get("description")||"").trim(),questions,published:fd.get("published")==="true",created_by:session.user.id};
      const {error}=await supabaseClient.from("assessments").insert(payload);
      if(error){dbError(error,"Could not save assessment");return;}
      showToast("Assessment saved.");await renderManageQuizzes();
    });
  };
  const bindViewActions = () => {
    $$("[data-go]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.go)));
  };
  const login = async (event) => {
    event.preventDefault();
    const message=$("#loginMessage");message.classList.remove("success");message.textContent="Signing in...";
    const client=getClient();
    if(!client){message.textContent="Backend not configured. Follow README.md to add your Supabase project URL and publishable/anon key.";return;}
    const email=$("#loginEmail").value.trim(),password=$("#loginPassword").value;
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error){message.textContent=error.message;return;}
    session=data.session;
    try{
      await fetchProfile();
      if(profile.role!==activeRole){const actualRole=roleName(profile.role);await client.auth.signOut();session=null;profile=null;message.textContent=`This account is registered as ${actualRole}. Choose the matching login tab.`;return;}
      setLoggedInUI();closeAuth();await setView("overview");
    }catch(err){console.error(err);message.textContent=`Account setup incomplete: ${err.message}. Ask the administrator to check profiles and role assignment.`;await client.auth.signOut();session=null;}
  };
  const logout = async () => {
    if(supabaseClient)await supabaseClient.auth.signOut();
    session=null;profile=null;linkedStudentIds=[];setLoggedOutUI();showToast("Signed out safely.");
  };
  const initConfig = () => {
    const cfg=config();
    if(cfg?.SUPABASE_URL&&cfg?.SUPABASE_ANON_KEY)return;
    const url=prompt("Supabase project URL (see README.md). Leave blank to preview the public landing page only:");
    if(!url)return;
    const key=prompt("Supabase publishable/anon key. Never use a service_role key here:");
    if(!key)return;
    localStorage.setItem(CONFIG_KEY,JSON.stringify({SUPABASE_URL:url.trim(),SUPABASE_ANON_KEY:key.trim(),PASS_MARK_PERCENT:PASS_MARK}));
    supabaseClient=null;
    showToast("Backend settings saved in this browser. For deployment, configure config.js or repeat on each device.");
  };
  const init = async () => {
    $("#year").textContent=new Date().getFullYear();
    $("#mobileMenu").addEventListener("click",()=>{
      const nav=$("#navLinks"),open=nav.classList.toggle("open");
      $("#mobileMenu").setAttribute("aria-expanded",String(open));
    });
    $$("[data-open-auth]").forEach(btn=>btn.addEventListener("click",()=>openAuth(btn.dataset.openAuth)));
    $("#closeAuth").addEventListener("click",closeAuth);
    $("#authModal").addEventListener("click",e=>{if(e.target===$("#authModal"))closeAuth();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAuth();});
    $$(".role-tab").forEach(btn=>btn.addEventListener("click",()=>{activeRole=btn.dataset.role;$$(".role-tab").forEach(b=>b.classList.toggle("active",b===btn));$("#loginMessage").textContent="";}));
    $("#loginForm").addEventListener("submit",login);
    $("#logoutButton").addEventListener("click",logout);
    $("#refreshButton").addEventListener("click",()=>setView(activeView));
    $$(".side-link").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
    const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");observer.unobserve(e.target);}}),{threshold:.12});
    $$(".reveal").forEach(el=>observer.observe(el));
    if(!config())setTimeout(initConfig,450);
    const client=getClient();
    if(client){
      const {data}=await client.auth.getSession();
      if(data.session){
        session=data.session;
        try{await fetchProfile();setLoggedInUI();await setView("overview");}
        catch(err){console.warn("Saved session profile not ready",err);await client.auth.signOut();setLoggedOutUI();}
      }
      client.auth.onAuthStateChange((_event,newSession)=>{if(!newSession&&session){session=null;profile=null;setLoggedOutUI();}});
    }
  };
  document.addEventListener("DOMContentLoaded",init);
})();
