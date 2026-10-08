const USERS_URL = "https://jsonplaceholder.typicode.com/users";

const loadButton = document.querySelector("#load-users");
const filterInput = document.querySelector("#filter-input");
const statusText = document.querySelector("#status");
const usersList = document.querySelector("#users-list");

let users = [];
let requestFailed = false;

function renderUsers(userList) {
  usersList.replaceChildren();

  if (!requestFailed && filterInput.value.trim() && userList.length === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.textContent = "No users match your filter.";
    usersList.append(emptyMessage);
    return;
  }

  userList.forEach((user) => {
    const item = document.createElement("li");
    const name = document.createElement("h2");
    const email = document.createElement("p");
    const city = document.createElement("p");
    const company = document.createElement("p");

    name.textContent = user.name;
    email.textContent = `Email: ${user.email}`;
    city.textContent = `City: ${user.address.city}`;
    company.textContent = `Company: ${user.company.name}`;

    item.append(name, email, city, company);
    usersList.append(item);
  });
}

async function loadUsers() {
  statusText.textContent = "Loading users...";
  loadButton.disabled = true;
  requestFailed = false;

  try {
    const response = await fetch(USERS_URL);
    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }

    users = await response.json();
    statusText.textContent = `Loaded ${users.length} users.`;
    renderUsers(users);
  } catch (error) {
    requestFailed = true;
    users = [];
    renderUsers(users);
    statusText.textContent = "Could not load users. Please try again.";
    console.error("Unable to load users:", error);
  } finally {
    loadButton.disabled = false;
  }
}

loadButton.addEventListener("click", loadUsers);

filterInput.addEventListener("input", () => {
  const searchTerm = filterInput.value.trim().toLowerCase();
  const filteredUsers = users.filter((user) =>
    user.name.toLowerCase().includes(searchTerm)
  );

  renderUsers(filteredUsers);
});
