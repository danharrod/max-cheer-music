const SHEET_KEY = "max-count-sheet";

function esc(value) {
  return String(value || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function loadSheet() {
  try {
    return JSON.parse(localStorage.getItem(SHEET_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSheet(data) {
  localStorage.setItem(SHEET_KEY, JSON.stringify(data));
}

function cell(name, value, extra = "") {
  return `<input name="${name}" value="${esc(value)}" autocomplete="off" ${extra} />`;
}

function rowsHtml(from, to, data) {
  let html = "";
  for (let n = from; n <= to; n += 1) {
    const section =
      n === 1
        ? `<span class="sheet-label">MUSIC STARTS</span>`
        : cell(`section_${n}`, data[`section_${n}`] || "");
    const firstCount =
      n === 47
        ? `<span class="sheet-end">END</span>`
        : cell(`r${n}_c1`, data[`r${n}_c1`] || "");
    html += `<tr>
      <td class="sheet-section">${section}</td>
      <td class="sheet-num">${n}</td>
      <td>${firstCount}</td>
      ${[2, 3, 4, 5, 6, 7, 8]
        .map((c) => `<td>${cell(`r${n}_c${c}`, data[`r${n}_c${c}`] || "")}</td>`)
        .join("")}
    </tr>`;
  }
  return html;
}

function table(from, to, data) {
  return `
    <table class="count-grid">
      <thead>
        <tr>
          <th>Routine section</th>
          <th></th>
          <th>1</th><th>2</th><th>3</th><th>4</th>
          <th>5</th><th>6</th><th>7</th><th>8</th>
        </tr>
      </thead>
      <tbody>${rowsHtml(from, to, data)}</tbody>
    </table>`;
}

function readForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    data[key] = String(value);
  });
  return data;
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("count-sheet");
  const status = document.getElementById("sheet-status");
  if (!form) return;
  const data = loadSheet();
  form.querySelector("[name=team_name]").value = data.team_name || "";
  document.getElementById("sheet-page-1").innerHTML = table(1, 23, data);
  document.getElementById("sheet-page-2").innerHTML = table(24, 47, data);

  form.addEventListener("input", () => {
    saveSheet(readForm(form));
    if (status) status.textContent = "Saved on this device.";
  });

  document.getElementById("sheet-print")?.addEventListener("click", () => {
    saveSheet(readForm(form));
    window.print();
  });

  document.getElementById("sheet-clear")?.addEventListener("click", () => {
    localStorage.removeItem(SHEET_KEY);
    location.reload();
  });
});
