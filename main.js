/*
 * Scrying Mirror of Productivity — Native Obsidian Plugin
 * Author: Lyra
 * License: MIT
 */
const { Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Notice, TFile, MarkdownRenderer, normalizePath } = require('obsidian');

const VIEW_TYPE_SCRYING_MIRROR = 'scrying-mirror-view';

const DEFAULT_SETTINGS = {
  tasksFilePath: 'ScryingMirror/Tasks.md',
  lecturesFolderPath: 'ScryingMirror/Lectures',
  journalFolderPath: 'ScryingMirror/Journal',
  attachmentsFolderPath: 'ScryingMirror/Attachments',
  statsFilePath: 'ScryingMirror/Telemetry.json',
  logToDailyNotes: true,
  defaultFocusDuration: 25,
  defaultShortBreak: 5,
  defaultLongBreak: 15,
  enableSoundChimes: true
};

class ScryingMirrorPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // Register Custom Obsidian ItemView
    this.registerView(
      VIEW_TYPE_SCRYING_MIRROR,
      (leaf) => new ScryingMirrorView(leaf, this)
    );

    // Add Ribbon Icon to Left Sidebar
    this.addRibbonIcon('sparkles', 'Open Scrying Mirror of Productivity', () => {
      this.activateView();
    });

    // Add Command to Palette
    this.addCommand({
      id: 'open-scrying-mirror',
      name: 'Open Scrying Mirror of Productivity',
      callback: () => {
        this.activateView();
      }
    });

    this.addCommand({
      id: 'start-focus-session',
      name: 'Start Pomodoro Focus Session',
      callback: () => {
        this.startQuickPomodoro();
      }
    });

    this.addCommand({
      id: 'log-offline-study',
      name: 'Log Offline Study / Focus Hours',
      callback: () => {
        this.activateView('stats');
      }
    });

    // Add Settings Tab
    this.addSettingTab(new ScryingMirrorSettingTab(this.app, this));

    console.log('Scrying Mirror of Productivity Plugin loaded successfully.');
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SCRYING_MIRROR);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView(initialView = null) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_SCRYING_MIRROR)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false) || workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_SCRYING_MIRROR,
        active: true
      });
    }

    workspace.revealLeaf(leaf);

    if (initialView && leaf.view instanceof ScryingMirrorView) {
      leaf.view.switchView(initialView);
    }
  }

  async startQuickPomodoro() {
    new Notice('⏱️ Scrying Mirror: Focus Session started (25m)');
    this.activateView('pomodoro');
  }

  // --- VAULT 2-WAY SYNC SERVICES ---
  async ensureFolderExists(path) {
    const normalized = normalizePath(path);
    const exists = this.app.vault.getAbstractFileByPath(normalized);
    if (!exists) {
      await this.app.vault.createFolder(normalized);
    }
  }

  // --- TASK & UNLIMITED SUBTASK VAULT API ---
  async getTasksFromVault() {
    const path = normalizePath(this.settings.tasksFilePath);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return [];

    const content = await this.app.vault.read(file);
    const lines = content.split('\n');
    const tasks = [];
    let currentParent = null;

    lines.forEach((line, index) => {
      const subMatch = line.match(/^(\s{2,}|\t+)-\s*\[([ xX])\]\s*(.*)$/);
      if (subMatch && currentParent) {
        const completed = subMatch[2].toLowerCase() === 'x';
        const cleanSub = subMatch[3].replace(/\(Created:.*?\)/g, '').trim();
        currentParent.subtasks.push({
          id: 'sub_' + index,
          title: cleanSub,
          completed,
          rawLine: line
        });
        return;
      }

      const parentMatch = line.match(/^-\s*\[([ xX])\]\s*(.*)$/);
      if (parentMatch) {
        const completed = parentMatch[1].toLowerCase() === 'x';
        let rawText = parentMatch[2];
        
        let priority = 'MEDIUM';
        if (rawText.toLowerCase().includes('#critical')) priority = 'CRITICAL';
        else if (rawText.toLowerCase().includes('#high')) priority = 'HIGH';
        else if (rawText.toLowerCase().includes('#low')) priority = 'LOW';

        let category = 'Deep Work';
        if (rawText.toLowerCase().includes('#projects')) category = 'Projects';
        else if (rawText.toLowerCase().includes('#study')) category = 'Study';
        else if (rawText.toLowerCase().includes('#habits')) category = 'Habits';

        let pomodorosDone = 0;
        let pomodorosTarget = 2;
        const pomoMatch = rawText.match(/🍅\s*(\d+)\/(\d+)/);
        if (pomoMatch) {
          pomodorosDone = parseInt(pomoMatch[1]) || 0;
          pomodorosTarget = parseInt(pomoMatch[2]) || 2;
        }

        const cleanTitle = rawText
          .replace(/#\w+/g, '')
          .replace(/🍅\s*\d+\/\d+/g, '')
          .replace(/\(Created:.*?\)/g, '')
          .trim();

        currentParent = {
          id: 'task_' + index,
          title: cleanTitle,
          completed,
          priority,
          category,
          pomodorosDone,
          pomodorosTarget,
          rawLine: line,
          subtasks: []
        };
        tasks.push(currentParent);
      }
    });

    return tasks;
  }

  async saveTaskToVault(taskTitle, priority = 'MEDIUM', category = 'Deep Work', targetPomo = 2) {
    await this.ensureFolderExists('ScryingMirror');
    const path = normalizePath(this.settings.tasksFilePath);
    let file = this.app.vault.getAbstractFileByPath(path);

    const taskLine = `- [ ] ${taskTitle} #${category.toLowerCase().replace(/\s+/g, '')} #${priority.toLowerCase()} 🍅 0/${targetPomo} (Created: ${new Date().toLocaleDateString()})\n`;

    if (!file) {
      await this.app.vault.create(path, `# ✧ Scrying Mirror Directives ✧\n\n## Active Tasks\n${taskLine}`);
    } else if (file instanceof TFile) {
      await this.app.vault.append(file, taskLine);
    }
  }

  async saveSubtaskToVault(parentTask, subtaskTitle) {
    const path = normalizePath(this.settings.tasksFilePath);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    const lines = content.split('\n');

    const parentIdx = lines.findIndex(l => l.trim() === parentTask.rawLine.trim());
    if (parentIdx !== -1) {
      let insertIdx = parentIdx + 1;
      while (insertIdx < lines.length && (lines[insertIdx].startsWith('  ') || lines[insertIdx].startsWith('\t'))) {
        insertIdx++;
      }
      lines.splice(insertIdx, 0, `    - [ ] ${subtaskTitle}`);
      await this.app.vault.modify(file, lines.join('\n'));
    }
  }

  async toggleSubtaskInVault(subtask) {
    const path = normalizePath(this.settings.tasksFilePath);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    if (subtask.completed) {
      content = content.replace(subtask.rawLine, subtask.rawLine.replace(/-\s*\[x\]/i, '- [ ]'));
    } else {
      content = content.replace(subtask.rawLine, subtask.rawLine.replace(/-\s*\[ \]/i, '- [x]'));
    }
    await this.app.vault.modify(file, content);
  }

  async deleteSubtaskInVault(subtask) {
    const path = normalizePath(this.settings.tasksFilePath);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    content = content.replace(subtask.rawLine + '\n', '').replace(subtask.rawLine, '');
    await this.app.vault.modify(file, content);
  }

  async toggleTaskInVault(task) {
    const path = normalizePath(this.settings.tasksFilePath);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    if (task.completed) {
      content = content.replace(task.rawLine, task.rawLine.replace(/-\s*\[x\]/i, '- [ ]'));
    } else {
      content = content.replace(task.rawLine, task.rawLine.replace(/-\s*\[ \]/i, '- [x]'));
      await this.recordTelemetryTaskDone();
    }
    await this.app.vault.modify(file, content);
  }

  async incrementTaskPomodoroInVault(taskTitle) {
    const path = normalizePath(this.settings.tasksFilePath);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    const lines = content.split('\n');
    const updated = lines.map(line => {
      if (line.includes(taskTitle)) {
        return line.replace(/🍅\s*(\d+)\/(\d+)/, (m, done, target) => {
          return `🍅 ${parseInt(done) + 1}/${target}`;
        });
      }
      return line;
    });

    await this.app.vault.modify(file, updated.join('\n'));
  }

  async deleteTaskFromVault(task) {
    const path = normalizePath(this.settings.tasksFilePath);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    const lines = content.split('\n');
    
    const parentIdx = lines.findIndex(l => l.trim() === task.rawLine.trim());
    if (parentIdx !== -1) {
      let deleteCount = 1;
      while (parentIdx + deleteCount < lines.length && (lines[parentIdx + deleteCount].startsWith('  ') || lines[parentIdx + deleteCount].startsWith('\t'))) {
        deleteCount++;
      }
      lines.splice(parentIdx, deleteCount);
      await this.app.vault.modify(file, lines.join('\n'));
    }
  }

  async clearCompletedTasksInVault() {
    const path = normalizePath(this.settings.tasksFilePath);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    const lines = content.split('\n');
    const filtered = [];
    let skippingSubtasks = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/^-\s*\[[xX]\]/)) {
        skippingSubtasks = true;
        continue;
      } else if (line.match(/^-\s*\[ \]/)) {
        skippingSubtasks = false;
        filtered.push(line);
      } else if (skippingSubtasks && (line.startsWith('  ') || line.startsWith('\t'))) {
        continue;
      } else {
        skippingSubtasks = false;
        filtered.push(line);
      }
    }

    await this.app.vault.modify(file, filtered.join('\n'));
  }

  // --- TELEMETRY & STATS DATA ENGINE ---
  async getTelemetryData() {
    const raw = localStorage.getItem('sm_vault_telemetry');
    if (raw) {
      try { return JSON.parse(raw); } catch (e) {}
    }
    return {
      history: {},
      totalFocusMins: 0,
      totalTasksCrushed: 0,
      activeStreak: 0,
      recordStreak: 0
    };
  }

  async recordTelemetryFocusSession(durationMins, taskTitle = null) {
    const data = await this.getTelemetryData();
    const today = new Date().toISOString().split('T')[0];
    const currentHour = new Date().getHours();

    if (!data.history[today]) {
      data.history[today] = { focusMins: 0, tasksDone: 0, hourly: Array(24).fill(0), sessions: [] };
    }
    if (!data.history[today].hourly) {
      data.history[today].hourly = Array(24).fill(0);
    }

    data.history[today].focusMins += durationMins;
    data.history[today].hourly[currentHour] = (data.history[today].hourly[currentHour] || 0) + durationMins;
    data.history[today].sessions.push({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      duration: durationMins,
      task: taskTitle || 'General Focus'
    });

    data.totalFocusMins += durationMins;
    this.calculateStreaks(data);

    localStorage.setItem('sm_vault_telemetry', JSON.stringify(data));
  }

  async recordTelemetryManualSession(dateStr, durationMins, subject = 'Offline Study', category = 'Study') {
    const data = await this.getTelemetryData();
    const targetDate = dateStr || new Date().toISOString().split('T')[0];
    const currentHour = new Date().getHours();

    if (!data.history[targetDate]) {
      data.history[targetDate] = { focusMins: 0, tasksDone: 0, hourly: Array(24).fill(0), sessions: [] };
    }
    if (!data.history[targetDate].hourly) {
      data.history[targetDate].hourly = Array(24).fill(0);
    }

    data.history[targetDate].focusMins += durationMins;
    data.history[targetDate].hourly[currentHour] = (data.history[targetDate].hourly[currentHour] || 0) + durationMins;
    data.history[targetDate].sessions.push({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (Manual)',
      duration: durationMins,
      task: `${subject} [${category}]`
    });

    data.totalFocusMins += durationMins;
    this.calculateStreaks(data);

    localStorage.setItem('sm_vault_telemetry', JSON.stringify(data));
    new Notice(`✓ Logged ${(durationMins / 60).toFixed(1)}h of offline study for ${targetDate}`);
  }

  async recordTelemetryTaskDone() {
    const data = await this.getTelemetryData();
    const today = new Date().toISOString().split('T')[0];

    if (!data.history[today]) {
      data.history[today] = { focusMins: 0, tasksDone: 0, hourly: Array(24).fill(0), sessions: [] };
    }

    data.history[today].tasksDone += 1;
    data.totalTasksCrushed += 1;
    this.calculateStreaks(data);

    localStorage.setItem('sm_vault_telemetry', JSON.stringify(data));
  }

  calculateStreaks(data) {
    const dates = Object.keys(data.history).sort();
    let currentStreak = 0;
    let maxStreak = 0;

    for (const d of dates) {
      if (data.history[d].focusMins > 0 || data.history[d].tasksDone > 0) {
        currentStreak++;
        if (currentStreak > maxStreak) maxStreak = currentStreak;
      }
    }

    data.activeStreak = currentStreak;
    data.recordStreak = Math.max(maxStreak, data.recordStreak || 0);
  }

  // --- LECTURES & JOURNAL VAULT API ---
  async saveLectureNotesToVault(videoTitle, videoUrl, notesContent) {
    await this.ensureFolderExists(this.settings.lecturesFolderPath);
    const safeTitle = (videoTitle || 'Lecture Notes').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const filePath = normalizePath(`${this.settings.lecturesFolderPath}/${safeTitle}.md`);
    let file = this.app.vault.getAbstractFileByPath(filePath);

    const noteBody = `---
type: lecture-note
source: "${videoUrl}"
updated: "${new Date().toISOString()}"
tags: [scrying-mirror, lecture]
---

# ${videoTitle}

**Source**: [Watch Video](${videoUrl})  
**Last Synced**: ${new Date().toLocaleString()}

---

## 📝 Timestamped Notes & Insights

${notesContent}
`;

    if (!file) {
      await this.app.vault.create(filePath, noteBody);
    } else if (file instanceof TFile) {
      await this.app.vault.modify(file, noteBody);
    }
    new Notice(`✓ Synced notes to ${filePath}`);
  }

  async saveImageAttachmentToVault(fileName, arrayBuffer) {
    await this.ensureFolderExists(this.settings.attachmentsFolderPath);
    const safeName = fileName.replace(/[/\\?%*:|"<>]/g, '-');
    const filePath = normalizePath(`${this.settings.attachmentsFolderPath}/${safeName}`);
    let file = this.app.vault.getAbstractFileByPath(filePath);

    if (!file) {
      file = await this.app.vault.createBinary(filePath, arrayBuffer);
    } else if (file instanceof TFile) {
      await this.app.vault.modifyBinary(file, arrayBuffer);
    }
    return file;
  }

  async saveJournalPostToVault(title, summary, readTime, content) {
    await this.ensureFolderExists(this.settings.journalFolderPath);
    const safeTitle = (title || 'Journal Log').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const filePath = normalizePath(`${this.settings.journalFolderPath}/${safeTitle}.md`);
    let file = this.app.vault.getAbstractFileByPath(filePath);

    const fileContent = `---
title: "${title}"
date: "${new Date().toLocaleDateString()}"
readTime: "${readTime}"
summary: "${summary}"
tags: [scrying-mirror, journal]
---

# ${title}

> *${summary}*  
> **Date**: ${new Date().toLocaleDateString()} // **Length**: ${readTime}

---

${content}
`;

    if (!file) {
      await this.app.vault.create(filePath, fileContent);
    } else if (file instanceof TFile) {
      await this.app.vault.modify(file, fileContent);
    }
    new Notice(`✓ Journal log saved to ${filePath}`);
  }

  async updateJournalPostInVault(oldFile, title, summary, content) {
    await this.ensureFolderExists(this.settings.journalFolderPath);
    const safeTitle = (title || 'Journal Log').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const newPath = normalizePath(`${this.settings.journalFolderPath}/${safeTitle}.md`);
    
    const words = content.trim().split(/\s+/).length;
    const readTime = `${Math.max(1, Math.round(words / 200))} MIN READ`;

    const fileContent = `---
title: "${title}"
date: "${new Date().toLocaleDateString()}"
readTime: "${readTime}"
summary: "${summary}"
tags: [scrying-mirror, journal]
---

# ${title}

> *${summary}*  
> **Date**: ${new Date().toLocaleDateString()} // **Length**: ${readTime}

---

${content}
`;

    if (oldFile && oldFile.path !== newPath) {
      await this.app.vault.delete(oldFile);
      await this.app.vault.create(newPath, fileContent);
    } else if (oldFile instanceof TFile) {
      await this.app.vault.modify(oldFile, fileContent);
    } else {
      await this.app.vault.create(newPath, fileContent);
    }
    new Notice(`✓ Updated journal log: ${title}`);
  }

  async deleteJournalPostFromVault(file) {
    if (file instanceof TFile) {
      const name = file.basename;
      await this.app.vault.delete(file);
      new Notice(`✓ Deleted journal log: ${name}`);
    }
  }

  async getJournalLogsFromVault() {
    await this.ensureFolderExists(this.settings.journalFolderPath);
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.journalFolderPath));
    if (!folder || !folder.children) return [];

    const logs = [];
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        const raw = await this.app.vault.read(child);
        const titleMatch = raw.match(/title:\s*"(.*?)"/) || [null, child.basename];
        const summaryMatch = raw.match(/summary:\s*"(.*?)"/) || [null, 'Personal log reflection'];
        const dateMatch = raw.match(/date:\s*"(.*?)"/) || [null, ''];
        
        // Extract raw body after frontmatter and main heading
        const bodyContent = raw.replace(/^---[\s\S]*?---\s*/, '').replace(/^#\s+.*?\n/, '').replace(/^>\s+.*?\n/gm, '').replace(/^---\s*/gm, '').trim();

        logs.push({
          file: child,
          title: titleMatch[1] || child.basename,
          summary: summaryMatch[1],
          date: dateMatch[1] || new Date(child.stat.mtime).toLocaleDateString(),
          mtime: child.stat.mtime,
          content: bodyContent || raw
        });
      }
    }
    return logs;
  }
}

// --- NATIVE OBSIDIAN ITEM VIEW ---
class ScryingMirrorView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentTimer = null;
    this.timeLeft = 25 * 60;
    this.timerTotal = 25 * 60;
    this.timerRunning = false;
    this.activeFocusTask = null;

    // Filters & States
    this.statusFilter = 'ALL';
    this.tagFilter = 'ALL';
    this.statsScale = 'day';
    this.expandedTasks = new Set();
    this.expandedJournalPosts = new Set();
    this.editingJournalFile = null;
    this.journalSort = 'NEWEST';

    this.selectedYear = new Date().getFullYear();
    this.selectedMonth = new Date().getMonth() + 1;
  }

  getViewType() {
    return VIEW_TYPE_SCRYING_MIRROR;
  }

  getDisplayText() {
    return 'Scrying Mirror';
  }

  getIcon() {
    return 'sparkles';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('scrying-mirror-obsidian-container');

    const todayStr = new Date().toISOString().split('T')[0];

    container.innerHTML = `
      <div class="sm-top-hud">
        <div class="sm-hud-left">
          <span class="sm-brand-dot"></span>
          <span class="sm-brand-title">SCRYING MIRROR // VAULT SUITE</span>
        </div>
        <div class="sm-hud-nav">
          <button class="sm-nav-btn active" data-view="home">✦ MIRROR</button>
          <button class="sm-nav-btn" data-view="todo">DIRECTIVES</button>
          <button class="sm-nav-btn" data-view="pomodoro">FOCUS CHRONO</button>
          <button class="sm-nav-btn" data-view="stats">TELEMETRY</button>
          <button class="sm-nav-btn" data-view="video">LECTURE HUB</button>
          <button class="sm-nav-btn" data-view="journal">JOURNAL</button>
        </div>
      </div>

      <div class="sm-mirror-surface">
        
        <!-- 1. VIEW: HOME -->
        <div id="sm-view-home" class="sm-subview active">
          <div class="sm-hero-center">
            <div class="sm-prompt-sym">&gt;</div>
            <h1 class="sm-title">W E L C O M E</h1>
            <p class="sm-subtitle">Speak to the mirror.<br>It remembers.</p>
            <div class="sm-star-sym">✦</div>
            <div class="sm-quick-stats-row">
              <div class="sm-quick-stat"><strong id="sm-stat-focus">0.0h</strong> FOCUS TIME</div>
              <div class="sm-quick-stat"><strong id="sm-stat-tasks">0</strong> TASKS DONE</div>
              <div class="sm-quick-stat"><strong id="sm-stat-streak">0d</strong> ACTIVE STREAK</div>
            </div>
          </div>
        </div>

        <!-- 2. VIEW: TODO MATRIX -->
        <div id="sm-view-todo" class="sm-subview">
          
          <div class="sm-progress-card">
            <div class="sm-progress-labels">
              <span>TOTAL OBJECTIVES: <strong id="sm-prog-total">0</strong></span>
              <span>COMPLETED: <strong id="sm-prog-completed">0</strong></span>
              <span>PROGRESS: <strong id="sm-prog-percent">0%</strong></span>
            </div>
            <div class="sm-progress-bar-bg">
              <div id="sm-prog-fill" class="sm-progress-bar-fill" style="width: 0%;"></div>
            </div>
          </div>

          <div class="sm-todo-create-card">
            <input type="text" id="sm-task-input" class="sm-input" placeholder="+ Add a new high-leverage objective or mission...">
            <div class="sm-create-options-row">
              <select id="sm-task-category" class="sm-select">
                <option value="Deep Work">Deep Work</option>
                <option value="Projects">Projects</option>
                <option value="Study">Study</option>
                <option value="Habits">Habits</option>
              </select>
              <select id="sm-task-priority" class="sm-select">
                <option value="CRITICAL">🔥 Critical</option>
                <option value="HIGH">⚡ High</option>
                <option value="MEDIUM" selected>✦ Medium</option>
                <option value="LOW">☕ Low</option>
              </select>
              <select id="sm-task-pomo-target" class="sm-select">
                <option value="1">🍅 1</option>
                <option value="2" selected>🍅 2</option>
                <option value="4">🍅 4</option>
                <option value="6">🍅 6</option>
              </select>
              <button id="sm-task-add-btn" class="sm-btn-primary">ADD DIRECTIVE ↵</button>
            </div>
          </div>

          <div class="sm-filter-toolbar">
            <div class="sm-status-filters">
              <button class="sm-filter-pill active" data-status="ALL">ALL</button>
              <button class="sm-filter-pill" data-status="ACTIVE">ACTIVE</button>
              <button class="sm-filter-pill" data-status="COMPLETED">COMPLETED</button>
            </div>
            <div class="sm-tag-filters">
              <button class="sm-tag-pill active" data-tag="ALL">All Tags</button>
              <button class="sm-tag-pill" data-tag="Deep Work">Deep Work</button>
              <button class="sm-tag-pill" data-tag="Projects">Projects</button>
              <button class="sm-tag-pill" data-tag="Study">Study</button>
              <button class="sm-tag-pill" data-tag="Habits">Habits</button>
            </div>
            <button id="sm-clear-completed-btn" class="sm-clear-btn">CLEAR COMPLETED</button>
          </div>

          <div id="sm-todo-list" class="sm-todo-list-box"></div>
        </div>

        <!-- 3. VIEW: POMODORO CHRONO -->
        <div id="sm-view-pomodoro" class="sm-subview">
          <div class="sm-panel-header">
            <h3>Focus Flow Chrono</h3>
            <span class="sm-tag" id="sm-active-focus-tag">FLOW_STATE // TIMER</span>
          </div>
          <div class="sm-pomodoro-layout">
            
            <div id="sm-active-task-banner" class="sm-focus-task-banner" style="display: none;">
              <span>🎯 FOCUSING ON: <strong id="sm-banner-task-title"></strong></span>
              <button id="sm-clear-focus-task-btn" class="sm-banner-close">✕</button>
            </div>

            <div class="sm-timer-modes">
              <button class="sm-mode-pill active" data-mins="25">FOCUS (25M)</button>
              <button class="sm-mode-pill" data-mins="5">SHORT BREAK (5M)</button>
              <button class="sm-mode-pill" data-mins="15">LONG BREAK (15M)</button>
            </div>
            <div class="sm-timer-dial-wrapper">
              <svg class="sm-svg-dial" viewBox="0 0 320 320">
                <circle class="sm-bg-circle" cx="160" cy="160" r="140" />
                <circle id="sm-fill-circle" class="sm-fill-circle" cx="160" cy="160" r="140" />
              </svg>
              <div class="sm-timer-readout">
                <div id="sm-time-text" class="sm-time-digits">25:00</div>
                <div class="sm-time-status">OBSIDIAN RESONANCE</div>
              </div>
            </div>
            <div class="sm-timer-actions">
              <button id="sm-timer-reset" class="sm-btn-sec">⟲ RESET</button>
              <button id="sm-timer-toggle" class="sm-btn-primary">▶ START FOCUS</button>
              <button id="sm-timer-skip" class="sm-btn-sec">⏭ SKIP</button>
            </div>
            <div class="sm-presets-row">
              <span style="font-size: 0.7rem; color: var(--text-muted);">PRESETS:</span>
              <button class="sm-duration-preset" data-mins="15">15m</button>
              <button class="sm-duration-preset" data-mins="25">25m</button>
              <button class="sm-duration-preset" data-mins="50">50m (Deep)</button>
              <button class="sm-duration-preset" data-mins="90">90m (Ultra)</button>
            </div>

            <button id="sm-pomodoro-offline-btn" class="sm-btn-sec" style="font-size: 0.72rem; margin-top: 6px; border-style: dashed;">
              ⏱️ Forgot to turn on timer? Log offline study hours
            </button>
          </div>
        </div>

        <!-- 4. VIEW: MULTI-TIMESCALE TELEMETRY & STATS -->
        <div id="sm-view-stats" class="sm-subview">
          <div class="sm-panel-header">
            <h3>Productivity Telemetry &amp; Analytics</h3>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button id="sm-open-manual-log-btn" class="sm-btn-primary" style="font-size: 0.72rem; padding: 4px 10px;">+ LOG OFFLINE STUDY</button>
              <div class="sm-stats-scale-tabs">
                <button class="sm-scale-tab active" data-scale="day">DAY</button>
                <button class="sm-scale-tab" data-scale="week">WEEK</button>
                <button class="sm-scale-tab" data-scale="month">MONTH</button>
                <button class="sm-scale-tab" data-scale="year">YEAR (365D)</button>
              </div>
            </div>
          </div>

          <!-- Offline Study Modal/Card -->
          <div id="sm-manual-log-box" class="sm-manual-log-card" style="display: none;">
            <div class="sm-manual-log-header">
              <span>⏱️ LOG OFFLINE / UNTRACKED STUDY SESSION</span>
              <button id="sm-manual-log-close" class="sm-btn-del-task">&times;</button>
            </div>
            <div class="sm-manual-log-form">
              <div class="sm-manual-row">
                <div class="sm-manual-field">
                  <label>Duration</label>
                  <div style="display: flex; gap: 6px; align-items: center;">
                    <input type="number" id="sm-manual-hours" class="sm-select" style="width: 60px;" min="0" max="24" value="1">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">hrs</span>
                    <input type="number" id="sm-manual-mins" class="sm-select" style="width: 60px;" min="0" max="59" value="0">
                    <span style="font-size: 0.75rem; color: var(--text-muted);">mins</span>
                  </div>
                </div>
                <div class="sm-manual-field">
                  <label>Date</label>
                  <input type="date" id="sm-manual-date" class="sm-input" value="${todayStr}" style="width: 140px;">
                </div>
                <div class="sm-manual-field">
                  <label>Category</label>
                  <select id="sm-manual-category" class="sm-select">
                    <option value="Study" selected>Study</option>
                    <option value="Deep Work">Deep Work</option>
                    <option value="Projects">Projects</option>
                    <option value="Habits">Habits</option>
                  </select>
                </div>
              </div>
              <div class="sm-manual-field" style="margin-top: 8px;">
                <label>Subject / Activity</label>
                <input type="text" id="sm-manual-subject" class="sm-input" placeholder="e.g. 2 hours DWDM record writing, Reading Algorithms...">
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
                <button id="sm-manual-cancel-btn" class="sm-btn-sec">Cancel</button>
                <button id="sm-manual-save-btn" class="sm-btn-primary">✦ SAVE TO STATS &amp; VAULT</button>
              </div>
            </div>
          </div>

          <!-- Top Summary Metrics Cards -->
          <div class="sm-metrics-grid">
            <div class="sm-metric-card">
              <div id="sm-card-focus" class="sm-metric-val">0.0H</div>
              <div class="sm-metric-lbl">FOCUS TIME</div>
            </div>
            <div class="sm-metric-card">
              <div id="sm-card-streak" class="sm-metric-val">0 DAYS</div>
              <div class="sm-metric-lbl">ACTIVE STREAK</div>
            </div>
            <div class="sm-metric-card">
              <div id="sm-card-record" class="sm-metric-val">0 DAYS</div>
              <div class="sm-metric-lbl">RECORD STREAK</div>
            </div>
            <div class="sm-metric-card">
              <div id="sm-card-tasks" class="sm-metric-val">0</div>
              <div class="sm-metric-lbl">TASKS CRUSHED</div>
            </div>
          </div>

          <!-- DAY PANEL -->
          <div id="sm-stats-panel-day" class="sm-stats-panel active">
            <div class="sm-panel-sub-header-row">
              <span>✦ TODAY'S 24-HOUR FOCUS TIMELINE</span>
              <span id="sm-day-metrics-summary" style="font-size: 0.72rem; color: var(--text-muted);">Focus: 0 mins | Tasks: 0</span>
            </div>
            <div id="sm-day-timeline-grid" class="sm-timeline-grid"></div>
            <div class="sm-recorded-sessions-header">RECORDED FOCUS SESSIONS:</div>
            <div id="sm-recorded-sessions-list" class="sm-sessions-list"></div>
          </div>

          <!-- WEEK PANEL -->
          <div id="sm-stats-panel-week" class="sm-stats-panel">
            <div class="sm-panel-sub-header-row">
              <span>✦ 7-DAY PRODUCTIVITY VELOCITY</span>
              <span id="sm-week-metrics-summary" style="font-size: 0.72rem; color: var(--text-muted);">0.0 hrs total</span>
            </div>
            <div id="sm-week-chart" class="sm-week-chart-grid"></div>
          </div>

          <!-- MONTH PANEL -->
          <div id="sm-stats-panel-month" class="sm-stats-panel">
            <div class="sm-month-nav-row">
              <button id="sm-month-prev" class="sm-btn-sec" style="padding: 2px 8px;">◀ PREV</button>
              <strong id="sm-month-label" style="font-size: 0.9rem; color: var(--text-normal);">August 2026</strong>
              <button id="sm-month-next" class="sm-btn-sec" style="padding: 2px 8px;">NEXT ▶</button>
            </div>
            <div id="sm-month-calendar" class="sm-month-grid"></div>
          </div>

          <!-- YEAR PANEL -->
          <div id="sm-stats-panel-year" class="sm-stats-panel">
            <div class="sm-panel-sub-header-row">
              <span>✦ 365-DAY CONTRIBUTION TELEMETRY HEATMAP</span>
              <div class="sm-heatmap-legend">
                <span>Less</span>
                <span class="sm-heat-cell level-0" style="display:inline-block; width:9px; height:9px;"></span>
                <span class="sm-heat-cell level-1" style="display:inline-block; width:9px; height:9px;"></span>
                <span class="sm-heat-cell level-2" style="display:inline-block; width:9px; height:9px;"></span>
                <span class="sm-heat-cell level-3" style="display:inline-block; width:9px; height:9px;"></span>
                <span class="sm-heat-cell level-4" style="display:inline-block; width:9px; height:9px;"></span>
                <span>More</span>
              </div>
            </div>
            <div class="sm-heatmap-scroll-box">
              <div id="sm-year-heatmap" class="sm-year-grid"></div>
            </div>
          </div>
        </div>

        <!-- 5. VIEW: LECTURE HUB -->
        <div id="sm-view-video" class="sm-subview">
          <div class="sm-panel-header">
            <h3>Lecture Theater &amp; Study Mirror</h3>
            <span class="sm-tag">MEDIA_SYNC // NOTES</span>
          </div>
          <div class="sm-lecture-grid">
            <div class="sm-video-player-side">
              <div class="sm-video-embed-box">
                <iframe id="sm-video-frame" src="https://www.youtube.com/embed/rfscVS0vtbw?rel=0" frameborder="0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>
              </div>
              <div class="sm-video-input-row">
                <input type="text" id="sm-yt-input" class="sm-input" placeholder="Paste YouTube lecture link or ID...">
                <button id="sm-yt-load-btn" class="sm-btn-sec">LOAD</button>
              </div>
            </div>
            <div class="sm-lecture-notes-side">
              <div class="sm-notes-header">
                <span>📝 LIVE LECTURE SCRATCHPAD</span>
                <button id="sm-save-vault-btn" class="sm-btn-primary" style="padding: 4px 10px; font-size: 0.7rem;">💾 SAVE TO VAULT</button>
              </div>
              <textarea id="sm-lecture-notes" class="sm-notes-area" placeholder="Take timestamped insights here... Auto-saves to your Obsidian vault!"></textarea>
            </div>
          </div>
        </div>

        <!-- 6. VIEW: JOURNAL STUDIO (RICH MEDIA & UNLIMITED INLINE IMAGES) -->
        <div id="sm-view-journal" class="sm-subview">
          <div class="sm-panel-header">
            <h3>Liquid Writings Studio</h3>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button id="sm-toggle-journal-composer" class="sm-btn-primary">+ WRITE NEW LOG</button>
            </div>
          </div>

          <div class="sm-journal-toolbar">
            <div class="sm-journal-sort-group">
              <span style="font-family: var(--font-monospace); font-size: 0.7rem; color: var(--text-muted);">SORT BY:</span>
              <button class="sm-filter-pill active" data-jsort="NEWEST">📅 Newest</button>
              <button class="sm-filter-pill" data-jsort="OLDEST">⌛ Oldest</button>
              <button class="sm-filter-pill" data-jsort="ALPHA">🔤 Title A-Z</button>
            </div>
            <span id="sm-journal-count" style="font-family: var(--font-monospace); font-size: 0.72rem; color: var(--text-muted);">0 Articles</span>
          </div>
          
          <!-- Journal Composer (with Image Upload, Clipboard Paste, Markdown Tools) -->
          <div id="sm-journal-composer-box" class="sm-journal-composer-card" style="display: none;">
            <div class="sm-composer-title-row">
              <span id="sm-composer-heading" style="font-family: var(--font-monospace); font-size: 0.76rem; font-weight: 600; color: var(--interactive-accent, #a78bfa);">✦ WRITE NEW ARTICLE</span>
              <button id="sm-composer-close-x" class="sm-btn-del-task">&times;</button>
            </div>
            <input type="text" id="sm-journal-title" class="sm-input" placeholder="Article / Log Title (e.g. Day 1: Architecture Breakdown)...">
            <input type="text" id="sm-journal-summary" class="sm-input" placeholder="Short reflection summary...">
            
            <!-- Rich Media Formatting Toolbar -->
            <div class="sm-editor-toolbar">
              <input type="file" id="sm-journal-img-file-input" accept="image/*" style="display: none;">
              <button id="sm-tb-btn-img" class="sm-tb-btn" title="Upload Image">🖼️ Add Image</button>
              <button id="sm-tb-btn-bold" class="sm-tb-btn" title="Bold Text">𝗕 Bold</button>
              <button id="sm-tb-btn-italic" class="sm-tb-btn" title="Italic Text">𝘐 Italic</button>
              <button id="sm-tb-btn-h2" class="sm-tb-btn" title="Heading 2">H2</button>
              <button id="sm-tb-btn-list" class="sm-tb-btn" title="Bullet List">• List</button>
              <button id="sm-tb-btn-check" class="sm-tb-btn" title="Task Checkbox">☑ Checkbox</button>
              <button id="sm-tb-btn-quote" class="sm-tb-btn" title="Blockquote">❝ Quote</button>
              <button id="sm-tb-btn-code" class="sm-tb-btn" title="Code Block">&lt;/&gt; Code</button>
              <span style="font-family: var(--font-monospace); font-size: 0.65rem; color: var(--text-muted); margin-left: auto;">💡 Tip: You can also Paste (Ctrl+V) or Drag images directly!</span>
            </div>

            <textarea id="sm-journal-content" class="sm-notes-area sm-journal-textarea" style="height: 240px; margin: 4px 0;" placeholder="Write your markdown log here... Insert unlimited images anywhere between your paragraphs! Supports drag & drop and clipboard paste (Ctrl+V)."></textarea>
            
            <div style="display: flex; justify-content: flex-end; gap: 8px;">
              <button id="sm-journal-cancel-btn" class="sm-btn-sec">CANCEL</button>
              <button id="sm-journal-save-btn" class="sm-btn-primary">✦ PUBLISH LOG TO VAULT</button>
            </div>
          </div>

          <!-- Journal List Grid -->
          <div id="sm-journal-list" class="sm-journal-list-grid"></div>
        </div>

      </div>
    `;

    this.bindViewEvents(container);
    this.renderTasks(container);
    this.renderTelemetry(container);
    this.renderJournalLogs(container);
  }

  switchView(viewName) {
    const container = this.containerEl.children[1];
    container.querySelectorAll('.sm-nav-btn').forEach(b => b.removeClass('active'));
    container.querySelectorAll('.sm-subview').forEach(v => v.removeClass('active'));

    const navBtn = container.querySelector(`.sm-nav-btn[data-view="${viewName}"]`);
    if (navBtn) navBtn.addClass('active');

    const subView = container.querySelector(`#sm-view-${viewName}`);
    if (subView) subView.addClass('active');

    if (viewName === 'todo') this.renderTasks(container);
    if (viewName === 'stats') this.renderTelemetry(container);
    if (viewName === 'journal') this.renderJournalLogs(container);
  }

  insertTextAtCursor(textarea, prefix, suffix = '') {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    const replacement = prefix + selected + suffix;
    textarea.value = text.substring(0, start) + replacement + text.substring(end);
    textarea.focus();
    textarea.selectionStart = start + prefix.length;
    textarea.selectionEnd = start + prefix.length + selected.length;
  }

  bindViewEvents(container) {
    // Navigation
    container.querySelectorAll('.sm-nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetView = e.currentTarget.getAttribute('data-view');
        this.switchView(targetView);
      });
    });

    // --- TODO MATRIX EVENTS ---
    const addTaskBtn = container.querySelector('#sm-task-add-btn');
    if (addTaskBtn) {
      addTaskBtn.addEventListener('click', async () => {
        const input = container.querySelector('#sm-task-input');
        const prio = container.querySelector('#sm-task-priority').value;
        const cat = container.querySelector('#sm-task-category').value;
        const pomoTarget = parseInt(container.querySelector('#sm-task-pomo-target').value) || 2;
        if (input && input.value.trim()) {
          await this.plugin.saveTaskToVault(input.value.trim(), prio, cat, pomoTarget);
          input.value = '';
          await this.renderTasks(container);
        }
      });
    }

    container.querySelectorAll('.sm-filter-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        const status = e.currentTarget.getAttribute('data-status');
        const tag = e.currentTarget.getAttribute('data-tag');
        const jsort = e.currentTarget.getAttribute('data-jsort');

        if (status) {
          container.querySelectorAll('.sm-status-filters .sm-filter-pill').forEach(p => p.removeClass('active'));
          e.currentTarget.addClass('active');
          this.statusFilter = status;
          this.renderTasks(container);
        } else if (tag) {
          container.querySelectorAll('.sm-tag-filters .sm-tag-pill').forEach(p => p.removeClass('active'));
          e.currentTarget.addClass('active');
          this.tagFilter = tag;
          this.renderTasks(container);
        } else if (jsort) {
          container.querySelectorAll('.sm-journal-sort-group .sm-filter-pill').forEach(p => p.removeClass('active'));
          e.currentTarget.addClass('active');
          this.journalSort = jsort;
          this.renderJournalLogs(container);
        }
      });
    });

    const clearCompletedBtn = container.querySelector('#sm-clear-completed-btn');
    if (clearCompletedBtn) {
      clearCompletedBtn.addEventListener('click', async () => {
        await this.plugin.clearCompletedTasksInVault();
        await this.renderTasks(container);
      });
    }

    // --- POMODORO TIMER EVENTS ---
    container.querySelectorAll('.sm-mode-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        container.querySelectorAll('.sm-mode-pill').forEach(p => p.removeClass('active'));
        e.currentTarget.addClass('active');
        const mins = parseInt(e.currentTarget.getAttribute('data-mins')) || 25;
        this.resetTimer(mins, container);
      });
    });

    container.querySelectorAll('.sm-duration-preset').forEach(preset => {
      preset.addEventListener('click', (e) => {
        const mins = parseInt(e.currentTarget.getAttribute('data-mins')) || 25;
        this.resetTimer(mins, container);
      });
    });

    const toggleBtn = container.querySelector('#sm-timer-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.toggleTimer(container);
      });
    }

    const resetBtn = container.querySelector('#sm-timer-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const activePill = container.querySelector('.sm-mode-pill.active');
        const mins = activePill ? parseInt(activePill.getAttribute('data-mins')) : 25;
        this.resetTimer(mins, container);
      });
    }

    const clearFocusBanner = container.querySelector('#sm-clear-focus-task-btn');
    if (clearFocusBanner) {
      clearFocusBanner.addEventListener('click', () => {
        this.activeFocusTask = null;
        container.querySelector('#sm-active-task-banner').style.display = 'none';
      });
    }

    const pomoOfflineBtn = container.querySelector('#sm-pomodoro-offline-btn');
    if (pomoOfflineBtn) {
      pomoOfflineBtn.addEventListener('click', () => {
        this.switchView('stats');
        const box = container.querySelector('#sm-manual-log-box');
        if (box) box.style.display = 'block';
      });
    }

    // --- MANUAL OFFLINE STUDY LOGGER EVENTS ---
    const openManualLog = container.querySelector('#sm-open-manual-log-btn');
    const manualLogBox = container.querySelector('#sm-manual-log-box');
    if (openManualLog && manualLogBox) {
      openManualLog.addEventListener('click', () => {
        manualLogBox.style.display = manualLogBox.style.display === 'none' ? 'block' : 'none';
      });
    }

    const closeManualLog = container.querySelector('#sm-manual-log-close');
    if (closeManualLog && manualLogBox) {
      closeManualLog.addEventListener('click', () => {
        manualLogBox.style.display = 'none';
      });
    }

    const cancelManualLog = container.querySelector('#sm-manual-cancel-btn');
    if (cancelManualLog && manualLogBox) {
      cancelManualLog.addEventListener('click', () => {
        manualLogBox.style.display = 'none';
      });
    }

    const saveManualLog = container.querySelector('#sm-manual-save-btn');
    if (saveManualLog && manualLogBox) {
      saveManualLog.addEventListener('click', async () => {
        const h = parseInt(container.querySelector('#sm-manual-hours').value) || 0;
        const m = parseInt(container.querySelector('#sm-manual-mins').value) || 0;
        const totalMins = (h * 60) + m;

        if (totalMins <= 0) {
          new Notice('Please enter a duration greater than 0.');
          return;
        }

        const dateStr = container.querySelector('#sm-manual-date').value || new Date().toISOString().split('T')[0];
        const subject = container.querySelector('#sm-manual-subject').value.trim() || 'Offline Study Session';
        const category = container.querySelector('#sm-manual-category').value || 'Study';

        await this.plugin.recordTelemetryManualSession(dateStr, totalMins, subject, category);
        
        container.querySelector('#sm-manual-subject').value = '';
        manualLogBox.style.display = 'none';

        await this.renderTelemetry(container);
      });
    }

    // --- TELEMETRY STATS SCALE TABS ---
    container.querySelectorAll('.sm-scale-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        container.querySelectorAll('.sm-scale-tab').forEach(t => t.removeClass('active'));
        e.currentTarget.addClass('active');
        this.statsScale = e.currentTarget.getAttribute('data-scale');
        
        container.querySelectorAll('.sm-stats-panel').forEach(p => p.removeClass('active'));
        const activePanel = container.querySelector(`#sm-stats-panel-${this.statsScale}`);
        if (activePanel) activePanel.addClass('active');

        this.renderTelemetry(container);
      });
    });

    const monthPrev = container.querySelector('#sm-month-prev');
    if (monthPrev) {
      monthPrev.addEventListener('click', () => {
        this.selectedMonth--;
        if (this.selectedMonth < 1) {
          this.selectedMonth = 12;
          this.selectedYear--;
        }
        this.renderMonthStats(container);
      });
    }

    const monthNext = container.querySelector('#sm-month-next');
    if (monthNext) {
      monthNext.addEventListener('click', () => {
        this.selectedMonth++;
        if (this.selectedMonth > 12) {
          this.selectedMonth = 1;
          this.selectedYear++;
        }
        this.renderMonthStats(container);
      });
    }

    // --- LECTURE HUB EVENTS ---
    const ytLoadBtn = container.querySelector('#sm-yt-load-btn');
    if (ytLoadBtn) {
      ytLoadBtn.addEventListener('click', () => {
        const val = container.querySelector('#sm-yt-input').value.trim();
        if (val) {
          let vidId = val;
          const match = val.match(/(?:youtu\.be\/|v=|\/embed\/)([a-zA-Z0-9_-]{11})/i);
          if (match && match[1]) vidId = match[1];
          container.querySelector('#sm-video-frame').src = `https://www.youtube.com/embed/${vidId}?rel=0`;
        }
      });
    }

    const saveNotesBtn = container.querySelector('#sm-save-vault-btn');
    if (saveNotesBtn) {
      saveNotesBtn.addEventListener('click', async () => {
        const notes = container.querySelector('#sm-lecture-notes').value;
        const ytInput = container.querySelector('#sm-yt-input').value || 'Lecture Notes';
        await this.plugin.saveLectureNotesToVault('Lecture ' + new Date().toLocaleDateString(), ytInput, notes);
      });
    }

    // --- JOURNAL STUDIO & IMAGE HANDLING EVENTS ---
    const toggleComposer = container.querySelector('#sm-toggle-journal-composer');
    const composerBox = container.querySelector('#sm-journal-composer-box');
    const journalTextarea = container.querySelector('#sm-journal-content');
    const imgFileInput = container.querySelector('#sm-journal-img-file-input');

    if (toggleComposer && composerBox) {
      toggleComposer.addEventListener('click', () => {
        this.editingJournalFile = null;
        container.querySelector('#sm-composer-heading').textContent = '✦ WRITE NEW ARTICLE';
        container.querySelector('#sm-journal-save-btn').textContent = '✦ PUBLISH LOG TO VAULT';
        container.querySelector('#sm-journal-title').value = '';
        container.querySelector('#sm-journal-summary').value = '';
        journalTextarea.value = '';
        composerBox.style.display = composerBox.style.display === 'none' ? 'flex' : 'none';
      });
    }

    // Toolbar Formatting Actions
    const boldBtn = container.querySelector('#sm-tb-btn-bold');
    if (boldBtn) boldBtn.addEventListener('click', () => this.insertTextAtCursor(journalTextarea, '**', '**'));
    const italicBtn = container.querySelector('#sm-tb-btn-italic');
    if (italicBtn) italicBtn.addEventListener('click', () => this.insertTextAtCursor(journalTextarea, '*', '*'));
    const h2Btn = container.querySelector('#sm-tb-btn-h2');
    if (h2Btn) h2Btn.addEventListener('click', () => this.insertTextAtCursor(journalTextarea, '\n## '));
    const listBtn = container.querySelector('#sm-tb-btn-list');
    if (listBtn) listBtn.addEventListener('click', () => this.insertTextAtCursor(journalTextarea, '\n- '));
    const checkBtn = container.querySelector('#sm-tb-btn-check');
    if (checkBtn) checkBtn.addEventListener('click', () => this.insertTextAtCursor(journalTextarea, '\n- [ ] '));
    const quoteBtn = container.querySelector('#sm-tb-btn-quote');
    if (quoteBtn) quoteBtn.addEventListener('click', () => this.insertTextAtCursor(journalTextarea, '\n> '));
    const codeBtn = container.querySelector('#sm-tb-btn-code');
    if (codeBtn) codeBtn.addEventListener('click', () => this.insertTextAtCursor(journalTextarea, '```\n', '\n```'));

    // Image Upload Button Trigger
    const imgBtn = container.querySelector('#sm-tb-btn-img');
    if (imgBtn && imgFileInput) {
      imgBtn.addEventListener('click', () => {
        imgFileInput.click();
      });

      imgFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          const arrayBuffer = await file.arrayBuffer();
          const timestamp = Date.now();
          const ext = file.name.split('.').pop() || 'png';
          const savedName = `image_${timestamp}.${ext}`;
          const savedFile = await this.plugin.saveImageAttachmentToVault(savedName, arrayBuffer);
          
          this.insertTextAtCursor(journalTextarea, `\n![${file.name}](${savedFile.path})\n`);
          new Notice(`✓ Added image: ${savedName}`);
          imgFileInput.value = '';
        }
      });
    }

    // Clipboard Paste (Ctrl+V) Image Handler on Journal Textarea
    if (journalTextarea) {
      journalTextarea.addEventListener('paste', async (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
          if (item.type.indexOf('image') === 0) {
            e.preventDefault();
            const blob = item.getAsFile();
            const arrayBuffer = await blob.arrayBuffer();
            const timestamp = Date.now();
            const ext = item.type.split('/')[1] || 'png';
            const savedName = `pasted_image_${timestamp}.${ext}`;
            const savedFile = await this.plugin.saveImageAttachmentToVault(savedName, arrayBuffer);

            this.insertTextAtCursor(journalTextarea, `\n![Image](${savedFile.path})\n`);
            new Notice(`✓ Pasted image saved to ${savedFile.path}`);
          }
        }
      });

      // Drag & Drop Image Handler
      journalTextarea.addEventListener('drop', async (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const file = e.dataTransfer.files[0];
          if (file.type.startsWith('image/')) {
            e.preventDefault();
            const arrayBuffer = await file.arrayBuffer();
            const timestamp = Date.now();
            const ext = file.name.split('.').pop() || 'png';
            const savedName = `dropped_${timestamp}.${ext}`;
            const savedFile = await this.plugin.saveImageAttachmentToVault(savedName, arrayBuffer);

            this.insertTextAtCursor(journalTextarea, `\n![${file.name}](${savedFile.path})\n`);
            new Notice(`✓ Dropped image saved to ${savedFile.path}`);
          }
        }
      });
    }

    const closeComposerX = container.querySelector('#sm-composer-close-x');
    if (closeComposerX && composerBox) {
      closeComposerX.addEventListener('click', () => {
        composerBox.style.display = 'none';
        this.editingJournalFile = null;
      });
    }

    const cancelComposer = container.querySelector('#sm-journal-cancel-btn');
    if (cancelComposer && composerBox) {
      cancelComposer.addEventListener('click', () => {
        composerBox.style.display = 'none';
        this.editingJournalFile = null;
      });
    }

    const journalBtn = container.querySelector('#sm-journal-save-btn');
    if (journalBtn) {
      journalBtn.addEventListener('click', async () => {
        const title = container.querySelector('#sm-journal-title').value.trim();
        const summary = container.querySelector('#sm-journal-summary').value.trim();
        const content = journalTextarea.value.trim();
        if (title && content) {
          if (this.editingJournalFile) {
            await this.plugin.updateJournalPostInVault(this.editingJournalFile, title, summary, content);
          } else {
            await this.plugin.saveJournalPostToVault(title, summary, '3 MIN READ', content);
          }
          container.querySelector('#sm-journal-title').value = '';
          container.querySelector('#sm-journal-summary').value = '';
          journalTextarea.value = '';
          composerBox.style.display = 'none';
          this.editingJournalFile = null;
          await this.renderJournalLogs(container);
        } else {
          new Notice('Please provide both a Title and Content for your journal post.');
        }
      });
    }
  }

  // --- RENDER TASK MATRIX WITH UNLIMITED SUBTASKS & [⚡ FOCUS] ---
  async renderTasks(container) {
    const list = container.querySelector('#sm-todo-list');
    if (!list) return;

    const allTasks = await this.plugin.getTasksFromVault();

    const total = allTasks.length;
    const completedCount = allTasks.filter(t => t.completed).length;
    const percent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    container.querySelector('#sm-prog-total').textContent = total;
    container.querySelector('#sm-prog-completed').textContent = completedCount;
    container.querySelector('#sm-prog-percent').textContent = percent + '%';
    container.querySelector('#sm-prog-fill').style.width = percent + '%';

    let filtered = allTasks;
    if (this.statusFilter === 'ACTIVE') filtered = filtered.filter(t => !t.completed);
    else if (this.statusFilter === 'COMPLETED') filtered = filtered.filter(t => t.completed);

    if (this.tagFilter !== 'ALL') {
      filtered = filtered.filter(t => t.category.toLowerCase() === this.tagFilter.toLowerCase());
    }

    if (filtered.length === 0) {
      list.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted); font-family: var(--font-monospace); font-size: 0.8rem;">✦ No directives matching filter. Add a new mission above!</div>`;
      return;
    }

    let html = '';
    filtered.forEach((t, i) => {
      const isExpanded = this.expandedTasks.has(t.id);
      const subCompleted = t.subtasks.filter(s => s.completed).length;
      const subTotal = t.subtasks.length;
      const subBadgeText = subTotal > 0 ? `(${subCompleted}/${subTotal})` : '+ subtasks';

      html += `
        <div class="sm-task-wrapper" data-task-id="${t.id}">
          <div class="sm-task-card ${t.completed ? 'completed' : ''}">
            <input type="checkbox" ${t.completed ? 'checked' : ''} class="sm-task-checkbox">
            <div class="sm-task-main">
              <div class="sm-task-title">${t.title}</div>
              <div class="sm-task-meta">
                <span class="sm-tag-cat">${t.category}</span>
                <span class="sm-task-prio prio-${t.priority.toLowerCase()}">${t.priority}</span>
                <span class="sm-pomo-count">🍅 ${t.pomodorosDone}/${t.pomodorosTarget} focus</span>
                <button class="sm-btn-expand-subtasks" data-task-id="${t.id}">
                  ${isExpanded ? '▲' : '▼'} ${subBadgeText}
                </button>
              </div>
            </div>
            <div class="sm-task-actions">
              ${!t.completed ? `<button class="sm-btn-focus-task" data-title="${t.title}" title="Focus on this task">⚡ FOCUS</button>` : ''}
              <button class="sm-btn-del-task" title="Delete task">&times;</button>
            </div>
          </div>

          <div class="sm-subtasks-drawer" style="display: ${isExpanded ? 'flex' : 'none'};">
            <div class="sm-subtasks-list">
              ${t.subtasks.map((s, sIdx) => `
                <div class="sm-subtask-item ${s.completed ? 'completed' : ''}" data-sub-idx="${sIdx}">
                  <input type="checkbox" ${s.completed ? 'checked' : ''} class="sm-subtask-checkbox">
                  <span class="sm-subtask-title">${s.title}</span>
                  <button class="sm-btn-focus-subtask" data-title="${t.title} ➔ ${s.title}" title="Focus on subtask">⚡</button>
                  <button class="sm-btn-del-subtask" title="Delete subtask">&times;</button>
                </div>
              `).join('')}
            </div>
            <div class="sm-subtask-add-row">
              <input type="text" class="sm-subtask-input sm-input" placeholder="+ Add subtask... (press Enter)">
              <button class="sm-subtask-add-btn sm-btn-primary">+</button>
            </div>
          </div>
        </div>
      `;
    });
    list.innerHTML = html;

    list.querySelectorAll('.sm-task-wrapper').forEach((wrapper, idx) => {
      const task = filtered[idx];

      const cb = wrapper.querySelector('.sm-task-checkbox');
      cb.addEventListener('change', async () => {
        await this.plugin.toggleTaskInVault(task);
        await this.renderTasks(container);
        this.renderTelemetry(container);
      });

      const expandBtn = wrapper.querySelector('.sm-btn-expand-subtasks');
      if (expandBtn) {
        expandBtn.addEventListener('click', () => {
          if (this.expandedTasks.has(task.id)) {
            this.expandedTasks.delete(task.id);
          } else {
            this.expandedTasks.add(task.id);
          }
          this.renderTasks(container);
        });
      }

      const subInput = wrapper.querySelector('.sm-subtask-input');
      const subAddBtn = wrapper.querySelector('.sm-subtask-add-btn');

      const handleAddSub = async () => {
        if (subInput && subInput.value.trim()) {
          await this.plugin.saveSubtaskToVault(task, subInput.value.trim());
          this.expandedTasks.add(task.id);
          await this.renderTasks(container);
        }
      };

      if (subAddBtn) subAddBtn.addEventListener('click', handleAddSub);
      if (subInput) {
        subInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') handleAddSub();
        });
      }

      wrapper.querySelectorAll('.sm-subtask-item').forEach((sItem, sIdx) => {
        const subtask = task.subtasks[sIdx];

        const sCb = sItem.querySelector('.sm-subtask-checkbox');
        if (sCb) {
          sCb.addEventListener('change', async () => {
            await this.plugin.toggleSubtaskInVault(subtask);
            await this.renderTasks(container);
          });
        }

        const sFocus = sItem.querySelector('.sm-btn-focus-subtask');
        if (sFocus) {
          sFocus.addEventListener('click', () => {
            this.activeFocusTask = { title: `${task.title} [${subtask.title}]` };
            container.querySelector('#sm-banner-task-title').textContent = `${task.title} ➔ ${subtask.title}`;
            container.querySelector('#sm-active-task-banner').style.display = 'flex';
            this.switchView('pomodoro');
            new Notice(`⚡ Focused on subtask: ${subtask.title}`);
          });
        }

        const sDel = sItem.querySelector('.sm-btn-del-subtask');
        if (sDel) {
          sDel.addEventListener('click', async () => {
            await this.plugin.deleteSubtaskInVault(subtask);
            await this.renderTasks(container);
          });
        }
      });

      const focusBtn = wrapper.querySelector('.sm-btn-focus-task');
      if (focusBtn) {
        focusBtn.addEventListener('click', () => {
          this.activeFocusTask = task;
          container.querySelector('#sm-banner-task-title').textContent = task.title;
          container.querySelector('#sm-active-task-banner').style.display = 'flex';
          this.switchView('pomodoro');
          new Notice(`⚡ Focused on: ${task.title}`);
        });
      }

      const delBtn = wrapper.querySelector('.sm-btn-del-task');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          await this.plugin.deleteTaskFromVault(task);
          await this.renderTasks(container);
        });
      }
    });
  }

  // --- POMODORO TIMER ENGINE ---
  toggleTimer(container) {
    if (this.timerRunning) {
      clearInterval(this.currentTimer);
      this.timerRunning = false;
      container.querySelector('#sm-timer-toggle').textContent = '▶ RESUME';
      container.querySelector('#sm-timer-toggle').removeClass('btn-running');
    } else {
      this.timerRunning = true;
      container.querySelector('#sm-timer-toggle').textContent = '⏸ PAUSE';
      container.querySelector('#sm-timer-toggle').addClass('btn-running');

      this.currentTimer = setInterval(() => {
        if (this.timeLeft > 0) {
          this.timeLeft--;
          this.updateTimerDisplay(container);
        } else {
          clearInterval(this.currentTimer);
          this.timerRunning = false;

          const durationMins = Math.round(this.timerTotal / 60);
          const taskName = this.activeFocusTask ? this.activeFocusTask.title : null;

          this.plugin.recordTelemetryFocusSession(durationMins, taskName);

          if (this.activeFocusTask) {
            this.plugin.incrementTaskPomodoroInVault(this.activeFocusTask.title);
          }

          new Notice('🔔 Focus session complete! Logged to vault telemetry.');
          container.querySelector('#sm-timer-toggle').textContent = '▶ START FOCUS';
          container.querySelector('#sm-timer-toggle').removeClass('btn-running');

          this.renderTasks(container);
          this.renderTelemetry(container);
        }
      }, 1000);
    }
  }

  resetTimer(mins, container) {
    clearInterval(this.currentTimer);
    this.timerRunning = false;
    this.timeLeft = mins * 60;
    this.timerTotal = mins * 60;
    this.updateTimerDisplay(container);
    container.querySelector('#sm-timer-toggle').textContent = '▶ START FOCUS';
    container.querySelector('#sm-timer-toggle').removeClass('btn-running');
  }

  updateTimerDisplay(container) {
    const m = Math.floor(this.timeLeft / 60);
    const s = this.timeLeft % 60;
    const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const timeElem = container.querySelector('#sm-time-text');
    if (timeElem) timeElem.textContent = timeStr;

    const circle = container.querySelector('#sm-fill-circle');
    if (circle && this.timerTotal > 0) {
      const offset = 879.6 * (1 - this.timeLeft / this.timerTotal);
      circle.style.strokeDashoffset = offset;
    }
  }

  // --- TELEMETRY & STATS RENDERER ---
  async renderTelemetry(container) {
    const data = await this.plugin.getTelemetryData();
    const today = new Date().toISOString().split('T')[0];
    const todayData = data.history[today] || { focusMins: 0, tasksDone: 0, hourly: Array(24).fill(0), sessions: [] };

    const totalHours = (data.totalFocusMins / 60).toFixed(1);
    container.querySelector('#sm-card-focus').textContent = totalHours + 'H';
    container.querySelector('#sm-card-streak').textContent = data.activeStreak + ' DAYS';
    container.querySelector('#sm-card-record').textContent = data.recordStreak + ' DAYS';
    container.querySelector('#sm-card-tasks').textContent = data.totalTasksCrushed;

    const homeFocus = container.querySelector('#sm-stat-focus');
    if (homeFocus) homeFocus.textContent = totalHours + 'h';
    const homeTasks = container.querySelector('#sm-stat-tasks');
    if (homeTasks) homeTasks.textContent = data.totalTasksCrushed;
    const homeStreak = container.querySelector('#sm-stat-streak');
    if (homeStreak) homeStreak.textContent = data.activeStreak + 'd';

    this.renderDayStats(container, todayData);
    this.renderWeekStats(container, data);
    this.renderMonthStats(container, data);
    this.renderYearStats(container, data);
  }

  renderDayStats(container, todayData) {
    const summaryLbl = container.querySelector('#sm-day-metrics-summary');
    if (summaryLbl) {
      summaryLbl.textContent = `Focus: ${todayData.focusMins} mins | Tasks: ${todayData.tasksDone}`;
    }

    const dayGrid = container.querySelector('#sm-day-timeline-grid');
    if (dayGrid) {
      let timelineHtml = '';
      const hourly = todayData.hourly || Array(24).fill(0);
      const maxMins = 60;

      for (let h = 0; h < 24; h++) {
        const mins = hourly[h] || 0;
        const percent = mins > 0 ? Math.min(100, Math.round((mins / maxMins) * 100)) : 0;

        timelineHtml += `
          <div class="sm-hour-wrapper" title="${String(h).padStart(2, '0')}:00 - ${mins}m focus">
            <div class="sm-hour-track">
              <div class="sm-hour-fill" style="height: ${percent}%;"></div>
            </div>
            <span class="sm-hour-label">${h % 3 === 0 ? h : ''}</span>
          </div>
        `;
      }
      dayGrid.innerHTML = timelineHtml;
    }

    const sessionsBox = container.querySelector('#sm-recorded-sessions-list');
    if (sessionsBox) {
      if (todayData.sessions && todayData.sessions.length > 0) {
        let sHtml = '';
        todayData.sessions.forEach(s => {
          sHtml += `
            <div class="sm-session-item">
              <span>⏱️ <strong>${s.duration}m Focus</strong> (${s.task})</span>
              <span style="color: var(--text-muted); font-size: 0.7rem;">${s.time}</span>
            </div>
          `;
        });
        sessionsBox.innerHTML = sHtml;
      } else {
        sessionsBox.innerHTML = `<div class="sm-empty-msg" style="padding: 12px 0;">No pomodoro sessions logged yet today. Click "Focus Chrono" or "+ LOG OFFLINE STUDY" to begin.</div>`;
      }
    }
  }

  renderWeekStats(container, data) {
    const weekGrid = container.querySelector('#sm-week-chart');
    if (!weekGrid) return;

    const daysNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);

    let totalWeekMins = 0;
    let weekHtml = '';

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const isToday = dateStr === now.toISOString().split('T')[0];
      const dayData = (data && data.history && data.history[dateStr]) || { focusMins: 0, tasksDone: 0 };
      
      totalWeekMins += dayData.focusMins;
      const heightPercent = dayData.focusMins > 0 ? Math.min(100, Math.round((dayData.focusMins / 120) * 100)) : 0;

      weekHtml += `
        <div class="sm-week-col ${isToday ? 'is-today' : ''}">
          <div class="sm-week-val">${dayData.focusMins > 0 ? `${dayData.focusMins}m` : ''}</div>
          <div class="sm-week-track">
            <div class="sm-week-fill" style="height: ${heightPercent}%;"></div>
          </div>
          <div class="sm-week-lbl">${daysNames[i]}</div>
          <div class="sm-week-tasks">${dayData.tasksDone > 0 ? `✓${dayData.tasksDone}` : '-'}</div>
        </div>
      `;
    }

    weekGrid.innerHTML = weekHtml;

    const weekSummary = container.querySelector('#sm-week-metrics-summary');
    if (weekSummary) {
      weekSummary.textContent = `${(totalWeekMins / 60).toFixed(1)} hrs total`;
    }
  }

  renderMonthStats(container, data) {
    const calendarGrid = container.querySelector('#sm-month-calendar');
    if (!calendarGrid) return;

    const monthsNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    container.querySelector('#sm-month-label').textContent = `${monthsNames[this.selectedMonth - 1]} ${this.selectedYear}`;

    const firstDay = new Date(this.selectedYear, this.selectedMonth - 1, 1).getDay();
    const daysInMonth = new Date(this.selectedYear, this.selectedMonth, 0).getDate();
    const offset = firstDay === 0 ? 6 : firstDay - 1;

    const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let html = '<div class="sm-month-headers-row">';
    dayHeaders.forEach(d => html += `<div class="sm-month-hdr-cell">${d}</div>`);
    html += '</div><div class="sm-month-days-grid">';

    for (let i = 0; i < offset; i++) {
      html += '<div class="sm-month-cell empty"></div>';
    }

    const todayStr = new Date().toISOString().split('T')[0];

    for (let day = 1; day <= daysInMonth; day++) {
      const mStr = String(this.selectedMonth).padStart(2, '0');
      const dStr = String(day).padStart(2, '0');
      const dateStr = `${this.selectedYear}-${mStr}-${dStr}`;
      const isToday = dateStr === todayStr;
      const dayData = (data && data.history && data.history[dateStr]) || { focusMins: 0, tasksDone: 0 };

      let level = 0;
      if (dayData.focusMins > 90 || dayData.tasksDone >= 5) level = 4;
      else if (dayData.focusMins > 50 || dayData.tasksDone >= 3) level = 3;
      else if (dayData.focusMins > 20 || dayData.tasksDone >= 1) level = 2;
      else if (dayData.focusMins > 0) level = 1;

      html += `
        <div class="sm-month-cell level-${level} ${isToday ? 'is-today' : ''}">
          <span class="sm-month-num">${day}</span>
          ${dayData.focusMins > 0 || dayData.tasksDone > 0 ? `
            <div class="sm-month-cell-metrics">
              ${dayData.focusMins > 0 ? `<span class="sm-cell-mins">${dayData.focusMins}m</span>` : ''}
              ${dayData.tasksDone > 0 ? `<span class="sm-cell-tasks">✓${dayData.tasksDone}</span>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }

    html += '</div>';
    calendarGrid.innerHTML = html;
  }

  renderYearStats(container, data) {
    const yearGrid = container.querySelector('#sm-year-heatmap');
    if (!yearGrid) return;

    let html = '';
    const now = new Date();

    for (let w = 51; w >= 0; w--) {
      html += '<div class="sm-heat-col">';
      for (let d = 0; d < 7; d++) {
        const targetDate = new Date(now);
        targetDate.setDate(now.getDate() - (w * 7 + (6 - d)));
        const dateStr = targetDate.toISOString().split('T')[0];
        const dayData = (data && data.history && data.history[dateStr]) || { focusMins: 0, tasksDone: 0 };

        let level = 0;
        if (dayData.focusMins > 90 || dayData.tasksDone >= 5) level = 4;
        else if (dayData.focusMins > 50 || dayData.tasksDone >= 3) level = 3;
        else if (dayData.focusMins > 20 || dayData.tasksDone >= 1) level = 2;
        else if (dayData.focusMins > 0 || dayData.tasksDone > 0) level = 1;

        html += `<div class="sm-heat-cell level-${level}" title="${dateStr}: ${dayData.focusMins}m focus, ${dayData.tasksDone} tasks"></div>`;
      }
      html += '</div>';
    }

    yearGrid.innerHTML = html;
  }

  // --- JOURNAL LOGS RENDERER WITH RICH OBSIDIAN MARKDOWN & IMAGE SUPPORT ---
  async renderJournalLogs(container) {
    const list = container.querySelector('#sm-journal-list');
    if (!list) return;

    let logs = await this.plugin.getJournalLogsFromVault();
    const countLabel = container.querySelector('#sm-journal-count');
    if (countLabel) countLabel.textContent = `${logs.length} ${logs.length === 1 ? 'Article' : 'Articles'}`;

    if (logs.length === 0) {
      list.innerHTML = `<div class="sm-empty-msg">No journal articles saved in vault yet. Click "+ WRITE NEW LOG" to publish your first entry!</div>`;
      return;
    }

    // Sort logs
    if (this.journalSort === 'NEWEST') {
      logs.sort((a, b) => b.mtime - a.mtime);
    } else if (this.journalSort === 'OLDEST') {
      logs.sort((a, b) => a.mtime - b.mtime);
    } else if (this.journalSort === 'ALPHA') {
      logs.sort((a, b) => a.title.localeCompare(b.title));
    }

    list.empty();

    logs.forEach((log, idx) => {
      const isExpanded = this.expandedJournalPosts.has(log.file.path);

      const card = list.createEl('div', { cls: 'sm-journal-card' });
      card.setAttribute('data-idx', idx);

      const header = card.createEl('div', { cls: 'sm-journal-header' });
      const titleBox = header.createEl('div', { cls: 'sm-journal-title-box' });
      titleBox.createEl('span', { cls: 'sm-journal-title', text: log.title });
      titleBox.createEl('span', { cls: 'sm-journal-date', text: log.date });

      const actions = header.createEl('div', { cls: 'sm-journal-card-actions' });
      const previewBtn = actions.createEl('button', {
        cls: 'sm-btn-j-action sm-btn-j-preview',
        text: isExpanded ? '▲ Collapse' : '👁️ Read'
      });
      const editBtn = actions.createEl('button', { cls: 'sm-btn-j-action sm-btn-j-edit', text: '✏️ Edit' });
      const openBtn = actions.createEl('button', { cls: 'sm-btn-j-action sm-btn-j-open', text: '🔗 Open' });
      const delBtn = actions.createEl('button', { cls: 'sm-btn-j-action sm-btn-j-del', text: '🗑️' });

      card.createEl('div', { cls: 'sm-journal-summary', text: log.summary });

      const bodyDrawer = card.createEl('div', { cls: 'sm-journal-body-drawer' });
      bodyDrawer.style.display = isExpanded ? 'block' : 'none';

      const bodyTextContainer = bodyDrawer.createEl('div', { cls: 'sm-journal-body-text markdown-rendered' });

      if (isExpanded) {
        MarkdownRenderer.renderMarkdown(log.content, bodyTextContainer, log.file.path, this);
      }

      // Event bindings
      previewBtn.addEventListener('click', () => {
        if (this.expandedJournalPosts.has(log.file.path)) {
          this.expandedJournalPosts.delete(log.file.path);
        } else {
          this.expandedJournalPosts.add(log.file.path);
        }
        this.renderJournalLogs(container);
      });

      editBtn.addEventListener('click', () => {
        this.editingJournalFile = log.file;
        const composerBox = container.querySelector('#sm-journal-composer-box');
        container.querySelector('#sm-composer-heading').textContent = `✏️ EDITING: ${log.title}`;
        container.querySelector('#sm-journal-save-btn').textContent = '✦ SAVE CHANGES TO VAULT';
        container.querySelector('#sm-journal-title').value = log.title;
        container.querySelector('#sm-journal-summary').value = log.summary;
        container.querySelector('#sm-journal-content').value = log.content;
        composerBox.style.display = 'flex';
        composerBox.scrollIntoView({ behavior: 'smooth' });
      });

      openBtn.addEventListener('click', () => {
        this.plugin.app.workspace.openLinkText(log.file.path, '', false);
      });

      delBtn.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to delete "${log.title}"?`)) {
          await this.plugin.deleteJournalPostFromVault(log.file);
          await this.renderJournalLogs(container);
        }
      });
    });
  }

  async onClose() {
    if (this.currentTimer) clearInterval(this.currentTimer);
  }
}

// --- OBSIDIAN SETTINGS TAB ---
class ScryingMirrorSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Scrying Mirror of Productivity Settings' });

    new Setting(containerEl)
      .setName('Tasks File Path')
      .setDesc('Path where directives will be saved and synchronized in markdown.')
      .addText(text => text
        .setValue(this.plugin.settings.tasksFilePath)
        .onChange(async (value) => {
          this.plugin.settings.tasksFilePath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Lectures Folder')
      .setDesc('Folder where lecture notes from the video workspace will be saved.')
      .addText(text => text
        .setValue(this.plugin.settings.lecturesFolderPath)
        .onChange(async (value) => {
          this.plugin.settings.lecturesFolderPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Journal Folder')
      .setDesc('Folder where Liquid Writings articles are saved.')
      .addText(text => text
        .setValue(this.plugin.settings.journalFolderPath)
        .onChange(async (value) => {
          this.plugin.settings.journalFolderPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Attachments Folder')
      .setDesc('Folder where pasted and uploaded images will be saved.')
      .addText(text => text
        .setValue(this.plugin.settings.attachmentsFolderPath)
        .onChange(async (value) => {
          this.plugin.settings.attachmentsFolderPath = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default Focus Duration (Minutes)')
      .setDesc('Default Pomodoro focus session time.')
      .addSlider(slider => slider
        .setLimits(5, 90, 5)
        .setValue(this.plugin.settings.defaultFocusDuration)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultFocusDuration = value;
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = ScryingMirrorPlugin;
