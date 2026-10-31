export function triggerDownload(url: string, fileName?: string): void {
  const a = document.createElement('a');
  a.href = url;
  if (fileName) {
    a.download = fileName;
  }
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    triggerDownload(url, fileName);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export function downloadText(
  content: string,
  fileName: string,
  mimeType = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, fileName);
}
