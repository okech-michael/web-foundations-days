let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

function searchNotes(word) {
  const searchTerm = word.toLowerCase();
  return notes.filter((note) => note.text.toLowerCase().includes(searchTerm));
}

function longestNote() {
  if (notes.length === 0) {
    return null;
  }

  return notes.reduce((longest, note) =>
    note.text.length > longest.text.length ? note : longest
  );
}

function countByCategory() {
  const counts = {};

  for (const note of notes) {
    counts[note.category] = (counts[note.category] || 0) + 1;
  }

  return counts;
}

function getSummary() {
  const counts = countByCategory();
  const categories = ["personal", "work", "study"];
  const categorySummary = categories
    .map((category) => `${counts[category] || 0} ${category}`)
    .join(", ");
  const noteLabel = notes.length === 1 ? "note" : "notes";

  return `${notes.length} ${noteLabel}: ${categorySummary}.`;
}

function isDuplicate(text) {
  const normalizedText = text.trim().toLowerCase();
  return notes.some((note) => note.text.trim().toLowerCase() === normalizedText);
}

function addNote(text, category) {
  const validCategories = ["personal", "work", "study"];

  if (typeof text !== "string" || text.trim().length < 1 || text.trim().length > 200) {
    console.log("Note not added: text must be 1–200 characters.");
    return false;
  }

  if (isDuplicate(text)) {
    console.log("Note not added: a note with that text already exists.");
    return false;
  }

  if (!validCategories.includes(category)) {
    console.log("Note not added: category must be personal, work, or study.");
    return false;
  }

  const nextId = notes.reduce((highestId, note) => Math.max(highestId, note.id), 0) + 1;
  notes.push({ id: nextId, text: text.trim(), category });
  return true;
}

console.log(searchNotes("DAY 3")); // Expected: [{ id: 2, text: "Finish the Day 3 assignment", category: "study" }]
console.log(searchNotes("nonexistent")); // Expected: []

console.log(longestNote()); // Expected: { id: 3, text: "Email the project report to Grace", category: "work" }
const originalNotes = notes;
notes = [];
console.log(longestNote()); // Expected: null
notes = originalNotes;

console.log(countByCategory()); // Expected: { personal: 2, study: 2, work: 1 }
notes = [];
console.log(countByCategory()); // Expected: {}
notes = originalNotes;

console.log(getSummary()); // Expected: "5 notes: 2 personal, 1 work, 2 study."
notes = [{ id: 1, text: "Only note", category: "study" }];
console.log(getSummary()); // Expected: "1 note: 0 personal, 0 work, 1 study."
notes = originalNotes;

console.log(isDuplicate("  BUY MILK AND BREAD  ")); // Expected: true
console.log(isDuplicate("A brand-new note")); // Expected: false

console.log(addNote("Plan weekend", "personal")); // Expected: true
console.log(addNote("  BUY MILK AND BREAD  ", "work")); // Expected: logs duplicate reason, then false
console.log(addNote("", "work")); // Expected: logs invalid-length reason, then false
console.log(addNote("Choose a tag", "other")); // Expected: logs invalid-category reason, then false
