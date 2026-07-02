// config.js
//
// Get a free key here: https://www.alphavantage.co/support/#api-key
//
// This file is intentionally separate from script.js and listed in
// .gitignore, so a real key never gets committed to version control.
// If you clone/share this project, copy config.example.js to config.js
// and fill in your own key there.
//
// Assigned directly on window (not `const CONFIG = ...`) so script.js
// can reliably read it: top-level const/let declarations in a classic
// script don't become window properties, only var and functions do.

window.CONFIG = {
  ALPHA_VANTAGE_API_KEY: "your_alpha_vantage_api",
};
