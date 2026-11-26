'use strict';

// Profile storage. Each profile has a stable id that names its own
// persistent browser partition, so logins never mix between profiles.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_PROFILES = 10;
const MAX_NAME_LENGTH = 32;

class ProfileStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { profiles: [], activeId: null };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.profiles)) {
        this.data.profiles = parsed.profiles
          .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
          .slice(0, MAX_PROFILES);
        this.data.activeId = parsed.activeId || null;
      }
    } catch {
      // Missing or unreadable file: start empty.
    }
    if (!this.get(this.data.activeId)) {
      this.data.activeId = this.data.profiles[0] ? this.data.profiles[0].id : null;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  list() {
    return this.data.profiles.map((p) => ({ ...p }));
  }

  get(id) {
    return this.data.profiles.find((p) => p.id === id) || null;
  }

  get activeId() {
    return this.data.activeId;
  }

  static cleanName(name) {
    const cleaned = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
    return cleaned;
  }

  nextDefaultName() {
    const names = new Set(this.data.profiles.map((p) => p.name));
    if (!names.has('Main')) return 'Main';
    for (let i = 1; ; i++) {
      if (!names.has(`Alt ${i}`)) return `Alt ${i}`;
    }
  }

  add(name) {
    if (this.data.profiles.length >= MAX_PROFILES) {
      throw new Error(`You can have at most ${MAX_PROFILES} profiles.`);
    }
    const profile = {
      id: crypto.randomUUID(),
      name: ProfileStore.cleanName(name) || this.nextDefaultName(),
      createdAt: Date.now(),
    };
    this.data.profiles.push(profile);
    this.data.activeId = profile.id;
    this.save();
    return { ...profile };
  }

  rename(id, name) {
    const profile = this.get(id);
    if (!profile) throw new Error('Profile not found.');
    const cleaned = ProfileStore.cleanName(name);
    if (!cleaned) throw new Error('Profile name cannot be empty.');
    profile.name = cleaned;
    this.save();
    return { ...profile };
  }

  remove(id) {
    const index = this.data.profiles.findIndex((p) => p.id === id);
    if (index === -1) return false;
    this.data.profiles.splice(index, 1);
    if (this.data.activeId === id) {
      const next = this.data.profiles[Math.min(index, this.data.profiles.length - 1)];
      this.data.activeId = next ? next.id : null;
    }
    this.save();
    return true;
  }

  move(id, toIndex) {
    const from = this.data.profiles.findIndex((p) => p.id === id);
    if (from === -1) return;
    const [p] = this.data.profiles.splice(from, 1);
    const to = Math.max(0, Math.min(toIndex, this.data.profiles.length));
    this.data.profiles.splice(to, 0, p);
    this.save();
  }

  setActive(id) {
    if (!this.get(id)) return;
    this.data.activeId = id;
    this.save();
  }
}

function partitionFor(id) {
  return `persist:tib-${id}`;
}

module.exports = { ProfileStore, partitionFor, MAX_PROFILES, MAX_NAME_LENGTH };
