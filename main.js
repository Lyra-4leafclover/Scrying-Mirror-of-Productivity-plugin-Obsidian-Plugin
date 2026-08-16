/*
 * Scrying Mirror of Productivity — Native Obsidian Plugin
 * Author: Lyra
 * License: MIT
 */
const { Plugin, ItemView, WorkspaceLeaf, PluginSettingTab, Setting, Notice, TFile, normalizePath } = require('obsidian');

const VIEW_TYPE_SCRYING_MIRROR = 'scrying-mirror-view';

const DEFAULT_SETTINGS = {
  tasksFilePath: 'ScryingMirror/Tasks.md',
  lecturesFolderPath: 'ScryingMirror/Lectures',
  journalFolderPath: 'ScryingMirror/Journal',
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

  async activateView() {
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
  }

  async startQuickPomodoro() {
    new Notice('⏱️ Scrying Mirror: Focus Session started (25m)');
    this.activateView();
  }

  // --- VAULT 2-WAY SYNC SERVICES ---
  async ensureFolderExists(path) {
    const normalized = normalizePath(path);
    const exists = this.app.vault.getAbstractFileByPath(normalized);
    if (!exists) {
      await this.app.vault.createFolder(normalized);
    }
  }

  async getTasksFromVault() {
    const path = normalizePath(this.settings.tasksFilePath);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) return [];

    const content = await this.app.vault.read(file);
    const lines = content.split('\n');
    const tasks = [];

    lines.forEach((line, index) => {
      const match = line.match(/^-\s*\[([ xX])\]\s*(.*)$/);
      if (match) {
        const completed = match[1].toLowerCase() === 'x';
        let text = match[2];
        let prio = 'MEDIUM';
        if (text.includes('#critical')) prio = 'CRITICAL';
        else if (text.includes('#high')) prio = 'HIGH';
        else if (text.includes('#low')) prio = 'LOW';

        tasks.push({
          id: 'task_' + index,
          title: text.replace(/#\w+/g, '').replace(/\(.*?\)/g, '').trim(),
          completed,
          priority: prio,
          rawLine: line
        });
      }
    });

    return tasks;
  }

  async saveTaskToVault(taskTitle, priority, category) {
    await this.ensureFolderExists('ScryingMirror');
    const path = normalizePath(this.settings.tasksFilePath);
    let file = this.app.vault.getAbstractFileByPath(path);

    const taskLine = `- [ ] ${taskTitle} #${priority.toLowerCase()} #${category.toLowerCase()} (Created: ${new Date().toLocaleDateString()})\n`;

    if (!file) {
      await this.app.vault.create(path, `# ✧ Scrying Mirror Directives ✧\n\n## Active Tasks\n${taskLine}`);
    } else if (file instanceof TFile) {
      await this.app.vault.append(file, taskLine);
    }
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
    }
    await this.app.vault.modify(file, content);
  }

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

    container.innerHTML = `
      <div class="sm-top-hud">
        <div class="sm-hud-left">
          <span class="sm-brand-dot"></span>
          <span class="sm-brand-title">SCRYING MIRROR // VAULT SYNC</span>
        </div>
        <div class="sm-hud-nav">
          <button class="sm-nav-btn active" data-view="home">✦ MIRROR</button>
          <button class="sm-nav-btn" data-view="todo">DIRECTIVES</button>
          <button class="sm-nav-btn" data-view="pomodoro">FOCUS CHRONO</button>
          <button class="sm-nav-btn" data-view="video">LECTURE HUB</button>
          <button class="sm-nav-btn" data-view="journal">JOURNAL</button>
        </div>
      </div>

      <div class="sm-mirror-surface">
        
        <!-- VIEW: HOME -->
        <div id="sm-view-home" class="sm-subview active">
          <div class="sm-hero-center">
            <div class="sm-prompt-sym">&gt;</div>
            <h1 class="sm-title">W E L C O M E</h1>
            <p class="sm-subtitle">Speak to the mirror.<br>It remembers.</p>
            <div class="sm-star-sym">✦</div>
            <div class="sm-quick-stats-row">
              <div class="sm-quick-stat"><strong id="sm-stat-focus">25m</strong> FOCUS READY</div>
              <div class="sm-quick-stat"><strong id="sm-stat-tasks">VAULT</strong> LIVE SYNC</div>
              <div class="sm-quick-stat"><strong>LOCAL-FIRST</strong> ENGINE</div>
            </div>
          </div>
        </div>

        <!-- VIEW: TODO MATRIX -->
        <div id="sm-view-todo" class="sm-subview">
          <div class="sm-panel-header">
            <h3>Directives &amp; Task Matrix</h3>
            <span class="sm-tag">VAULT_SYNC // ACTIVE</span>
          </div>
          <div class="sm-todo-input-row">
            <input type="text" id="sm-task-input" class="sm-input" placeholder="Add directive (e.g. Implement Graph Neural Network)...">
            <select id="sm-task-priority" class="sm-select">
              <option value="CRITICAL">🔥 CRITICAL</option>
              <option value="HIGH">⚡ HIGH</option>
              <option value="MEDIUM" selected>✦ MEDIUM</option>
              <option value="LOW">☕ LOW</option>
            </select>
            <button id="sm-task-add-btn" class="sm-btn-primary">+ ADD DIRECTIVE</button>
          </div>
          <div id="sm-todo-list" class="sm-todo-list-box"></div>
        </div>

        <!-- VIEW: POMODORO CHRONO -->
        <div id="sm-view-pomodoro" class="sm-subview">
          <div class="sm-panel-header">
            <h3>Focus Flow Chrono</h3>
            <span class="sm-tag">FLOW_STATE // TIMER</span>
          </div>
          <div class="sm-pomodoro-layout">
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
          </div>
        </div>

        <!-- VIEW: LECTURE HUB -->
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

        <!-- VIEW: JOURNAL -->
        <div id="sm-view-journal" class="sm-subview">
          <div class="sm-panel-header">
            <h3>Liquid Writings &amp; Engineering Logs</h3>
            <span class="sm-tag">VAULT_JOURNAL // SYNC</span>
          </div>
          <div class="sm-journal-form">
            <input type="text" id="sm-journal-title" class="sm-input" placeholder="Article / Log Title...">
            <input type="text" id="sm-journal-summary" class="sm-input" placeholder="Short reflection summary...">
            <textarea id="sm-journal-content" class="sm-notes-area" style="height: 140px; margin: 8px 0;" placeholder="Write your log here... Saves as markdown in your vault!"></textarea>
            <button id="sm-journal-save-btn" class="sm-btn-primary">✦ PUBLISH LOG TO VAULT</button>
          </div>
        </div>

      </div>
    `;

    this.bindViewEvents(container);
    this.renderTasks(container);
  }

  bindViewEvents(container) {
    // Navigation
    container.querySelectorAll('.sm-nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetView = e.currentTarget.getAttribute('data-view');
        container.querySelectorAll('.sm-nav-btn').forEach(b => b.removeClass('active'));
        container.querySelectorAll('.sm-subview').forEach(v => v.removeClass('active'));
        e.currentTarget.addClass('active');

        const activeSub = container.querySelector(`#sm-view-${targetView}`);
        if (activeSub) activeSub.addClass('active');
        if (targetView === 'todo') this.renderTasks(container);
      });
    });

    // Task addition
    const addTaskBtn = container.querySelector('#sm-task-add-btn');
    if (addTaskBtn) {
      addTaskBtn.addEventListener('click', async () => {
        const input = container.querySelector('#sm-task-input');
        const prio = container.querySelector('#sm-task-priority').value;
        if (input && input.value.trim()) {
          await this.plugin.saveTaskToVault(input.value.trim(), prio, 'CORE');
          input.value = '';
          await this.renderTasks(container);
        }
      });
    }

    // Pomodoro Mode Switch
    container.querySelectorAll('.sm-mode-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        container.querySelectorAll('.sm-mode-pill').forEach(p => p.removeClass('active'));
        e.currentTarget.addClass('active');
        const mins = parseInt(e.currentTarget.getAttribute('data-mins')) || 25;
        this.resetTimer(mins, container);
      });
    });

    // Pomodoro Toggle
    const toggleBtn = container.querySelector('#sm-timer-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.toggleTimer(container);
      });
    }

    // Pomodoro Reset
    const resetBtn = container.querySelector('#sm-timer-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const activePill = container.querySelector('.sm-mode-pill.active');
        const mins = activePill ? parseInt(activePill.getAttribute('data-mins')) : 25;
        this.resetTimer(mins, container);
      });
    }

    // Video Load
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

    // Save Lecture Notes
    const saveNotesBtn = container.querySelector('#sm-save-vault-btn');
    if (saveNotesBtn) {
      saveNotesBtn.addEventListener('click', async () => {
        const notes = container.querySelector('#sm-lecture-notes').value;
        const ytInput = container.querySelector('#sm-yt-input').value || 'Lecture Notes';
        await this.plugin.saveLectureNotesToVault('Lecture ' + new Date().toLocaleDateString(), ytInput, notes);
      });
    }

    // Save Journal
    const journalBtn = container.querySelector('#sm-journal-save-btn');
    if (journalBtn) {
      journalBtn.addEventListener('click', async () => {
        const title = container.querySelector('#sm-journal-title').value.trim();
        const summary = container.querySelector('#sm-journal-summary').value.trim();
        const content = container.querySelector('#sm-journal-content').value.trim();
        if (title && content) {
          await this.plugin.saveJournalPostToVault(title, summary, '3 MIN READ', content);
          container.querySelector('#sm-journal-title').value = '';
          container.querySelector('#sm-journal-summary').value = '';
          container.querySelector('#sm-journal-content').value = '';
        }
      });
    }
  }

  async renderTasks(container) {
    const list = container.querySelector('#sm-todo-list');
    if (!list) return;

    const tasks = await this.plugin.getTasksFromVault();
    if (tasks.length === 0) {
      list.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.8rem;">No active tasks in vault yet. Add one above!</div>`;
      return;
    }

    let html = '';
    tasks.forEach(t => {
      html += `
        <div class="sm-task-item ${t.completed ? 'completed' : ''}" data-id="${t.id}">
          <input type="checkbox" ${t.completed ? 'checked' : ''} class="sm-task-checkbox">
          <span class="sm-task-title">${t.title}</span>
          <span class="sm-task-prio prio-${t.priority.toLowerCase()}">${t.priority}</span>
        </div>
      `;
    });
    list.innerHTML = html;

    list.querySelectorAll('.sm-task-item').forEach((item, i) => {
      const cb = item.querySelector('.sm-task-checkbox');
      cb.addEventListener('change', async () => {
        await this.plugin.toggleTaskInVault(tasks[i]);
        await this.renderTasks(container);
      });
    });
  }

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
          new Notice('🔔 Focus session complete! Great work.');
          container.querySelector('#sm-timer-toggle').textContent = '▶ START FOCUS';
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
