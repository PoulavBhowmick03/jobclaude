export async function readResume(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('File exceeds 10 MB.');
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return (await file.text()).split('\n');
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = worker.default;
  const task = getDocument({
    data: await file.arrayBuffer(), isEvalSupported: false,
    disableFontFace: true, useSystemFonts: false, stopAtErrors: true,
  });
  try {
    const pdf = await task.promise;
    const lines = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const { items } = await page.getTextContent();
      let line = '';
      for (const item of items) {
        if (typeof item.str !== 'string') continue;
        line += ' ' + item.str;
        if (!item.hasEOL) continue;
        lines.push(line.trim());
        line = '';
      }
      if (line.trim()) lines.push(line.trim());
    }
    return lines;
  } finally {
    await task.destroy();
  }
}
