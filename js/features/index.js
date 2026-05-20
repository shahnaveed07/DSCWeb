import { requestJson } from "../core/api.js";

export async function initHomePage() {
  const homeDownloadBtn = document.getElementById("homeDownloadBtn");

  if (!homeDownloadBtn) return;

  try {
    const result = await requestJson("/api/admin/system-status", {
      method: "GET",
      retries: 0,
    });

    if (!result.ok || !result.data) {
      homeDownloadBtn.style.display = "none";
      return;
    }

    const settings = result.data;

    const downloadEnabled =
  settings.showHomeDownloadBtn === true ||
  settings.ShowHomeDownloadBtn === true ||
  settings.btnDownload === true ||
  settings.BtnDownload === true ||
  settings.enableDownload === true ||
  settings.EnableDownload === true;

   const downloadLink =
  settings.freeLink ||
  settings.FreeLink ||
  settings.downloadUrl ||
  settings.DownloadUrl ||
  settings.panelLink ||
  settings.PanelLink;

    homeDownloadBtn.style.removeProperty("display");

    if (downloadEnabled) {
      homeDownloadBtn.href = downloadLink;

      homeDownloadBtn.classList.remove("d-none");
    } else {
      homeDownloadBtn.classList.add("d-none");
    }
  } catch (err) {
    homeDownloadBtn.classList.add("d-none");
  }
}
