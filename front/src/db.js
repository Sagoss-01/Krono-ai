import Dexie from 'dexie';

export const db = new Dexie('KronoAIDatabase');

// Déclaration de la structure IndexedDB locale pour le mode hors-ligne
db.version(3).stores({
  events: 'id, title, start_time, end_time, constraint_type, status, source, external_id',
  conversations: 'id, title, timestamp',
  messages: '++id, conversationId, sender, text, timestamp',
  preferences: 'key, value',
  offline_mutations: '++id, type, targetId, data, timestamp'
});
