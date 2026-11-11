// Manages who can sign in to the dashboard.
//
//   npm run users -- list
//   npm run users -- add <username>      prompts for a password
//   npm run users -- reset <username>    sets a new password
//   npm run users -- remove <username>
//
// Changes take effect on the next `npm run snapshot`. Rebuild and redeploy the
// snapshot after adding, resetting or removing anyone.
//
// The password can also come from A4A_PASSWORD, for scripted use. It is never
// stored: see scripts/encrypt.mjs for what is.

import readline from "node:readline";
import {
  USERS_FILE, MIN_PASSWORD_LENGTH,
  loadUsers, saveUsers, createUser, normalizeUsername, isValidUsername,
} from "./encrypt.mjs";

const [command, rawName] = process.argv.slice(2);
const username = normalizeUsername(rawName);

function fail(msg) {
  console.error(`\n  ! ${msg}\n`);
  process.exit(1);
}

// Reads a line without echoing it.
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); };
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
    rl.on("SIGINT", () => { rl.close(); reject(new Error("cancelled")); });
  });
}

function checkLength(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`That password is ${password.length} characters. Use at least ${MIN_PASSWORD_LENGTH}.\n` +
      "    Four unrelated words works well, e.g. plateau-cinnamon-harbor-ninety");
  }
}

async function getPassword() {
  if (process.env.A4A_PASSWORD) {
    checkLength(process.env.A4A_PASSWORD);
    return process.env.A4A_PASSWORD;
  }
  if (!process.stdin.isTTY) fail("No terminal to type a password into. Set A4A_PASSWORD instead.");

  const first = await askHidden(`  Password for ${username}: `);
  checkLength(first);
  const second = await askHidden("  Repeat it: ");
  if (first !== second) fail("The two passwords did not match.");
  return first;
}

function requireName() {
  if (!rawName) fail(`Give a username: npm run users -- ${command} <username>`);
  if (!isValidUsername(username)) {
    fail("Usernames are 2-64 characters of letters, digits and . _ @ + -");
  }
}

const users = loadUsers();
const existing = users.find((u) => u.username === username);
const REBUILD = "  Rebuild the snapshot (npm run snapshot) and redeploy it for this to take effect.";

try {
  switch (command) {
    case "list": {
      if (!users.length) {
        console.log("\n  No users yet. Add one with: npm run users -- add <username>\n");
        break;
      }
      console.log(`\n  ${users.length} user(s) in ${USERS_FILE}\n`);
      for (const u of users) console.log(`    ${u.username.padEnd(32)} added ${u.createdAt.slice(0, 10)}`);
      console.log("");
      break;
    }

    case "add":
    case "reset": {
      requireName();
      if (command === "add" && existing) fail(`${username} already exists. Use reset to change the password.`);
      if (command === "reset" && !existing) fail(`${username} does not exist. Use add.`);

      const password = await getPassword();
      const record = await createUser(username, password);
      saveUsers([...users.filter((u) => u.username !== username), record]);
      console.log(`\n  ${command === "add" ? "Added" : "Reset password for"} ${username}.\n${REBUILD}\n`);
      break;
    }

    case "remove": {
      requireName();
      if (!existing) fail(`${username} does not exist.`);
      saveUsers(users.filter((u) => u.username !== username));
      console.log(`\n  Removed ${username}.\n${REBUILD}\n`);
      break;
    }

    default:
      console.log(`
  Usage:
    npm run users -- list
    npm run users -- add <username>
    npm run users -- reset <username>
    npm run users -- remove <username>
`);
      if (command) process.exit(1);
  }
} catch (e) {
  fail(e.message);
}
