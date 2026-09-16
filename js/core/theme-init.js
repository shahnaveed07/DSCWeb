(() => {
  try {
    const savedTheme = localStorage.getItem("siteTheme");

    if (savedTheme === "light" || savedTheme === "dark") {
      document.documentElement.setAttribute("data-theme", savedTheme);
    }
  } catch {
    // Ignore localStorage access errors.
  }
})();