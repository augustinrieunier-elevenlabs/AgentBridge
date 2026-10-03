(function () {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");
  ReactDOM.createRoot(root).render(<window.AB.ui.App />);
})();
