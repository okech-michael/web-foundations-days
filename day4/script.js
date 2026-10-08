const noteText = document.querySelector("#note-text");
const charCount = document.querySelector("#char-count");
const wordCount = document.querySelector("#word-count");
const clearButton = document.querySelector("#clear-btn");
const themeToggle = document.querySelector("#theme-toggle");

const DRAFT_KEY = "quicknotes-draft";
const THEME_KEY = "quicknotes-theme";

function updateCounts() {
  const characterTotal = noteText.value.length;
  const words = noteText.value.trim().split(/\s+/).filter(Boolean);

  charCount.textContent = `${characterTotal} / 200 characters`;
  wordCount.textContent = `${words.length} ${words.length === 1 ? "word" : "words"}`;
  charCount.classList.toggle("warning", characterTotal > 180);
  charCount.classList.toggle("over", characterTotal > 200);
}

function clearNote() {
  noteText.value = "";
  localStorage.removeItem(DRAFT_KEY);
  updateCounts();
}

function updateThemeButton() {
  themeToggle.textContent = document.body.classList.contains("dark") ? "Light mode" : "Dark mode";
}

noteText.value = localStorage.getItem(DRAFT_KEY) || "";

if (localStorage.getItem(THEME_KEY) === "dark") {
  document.body.classList.add("dark");
}

updateThemeButton();
updateCounts();

noteText.addEventListener("input", () => {
  updateCounts();
  localStorage.setItem(DRAFT_KEY, noteText.value);
});

clearButton.addEventListener("click", clearNote);

noteText.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    clearNote();
  }
});

themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const theme = document.body.classList.contains("dark") ? "dark" : "light";
  localStorage.setItem(THEME_KEY, theme);
  updateThemeButton();
});
