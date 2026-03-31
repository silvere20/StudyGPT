import type { StudyPlan } from '../api/client';

/** Strip basic markdown syntax from text so it reads cleanly in a PDF. */
function stripMd(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/gs, '$2')
    .replace(/([*_])(.*?)\1/gs, '$2')
    .replace(/\$\$[\s\S]*?\$\$/g, '[formule]')
    .replace(/\$[^$\n]+?\$/g, '[formule]')
    .replace(/`[^`]+`/g, (m) => m.slice(1, -1))
    .trim();
}

/**
 * Generate and download a PDF of the study plan.
 * Always uses light-mode colors regardless of the user's dark-mode preference.
 */
export async function exportStudyPlanAsPdf(
  plan: StudyPlan,
  topicOrder: string[],
): Promise<void> {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;
  const pageH = 297;
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;
  let pageNum = 1;
  let currentChapterTitle = '';

  const addPage = () => {
    // Footer on current page
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`StudyFlow AI  ·  pagina ${pageNum}`, margin, pageH - 8);
    if (currentChapterTitle) {
      doc.text(currentChapterTitle.slice(0, 80), pageW / 2, pageH - 8, { align: 'center' });
    }
    doc.addPage();
    pageNum++;
    y = margin;
    doc.setTextColor(0);
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - 20) addPage();
  };

  const writeText = (text: string, fontSize: number, color: [number, number, number] = [0, 0, 0], bold = false) => {
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const line of lines) {
      ensureSpace(fontSize * 0.4 + 1);
      doc.text(line, margin, y);
      y += fontSize * 0.4 + 1;
    }
  };

  // ── Cover page ──
  doc.setFillColor(255, 237, 213); // orange-100
  doc.rect(0, 0, pageW, 60, 'F');

  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(234, 88, 12); // orange-600
  doc.text('StudyFlow AI', margin, 30);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);
  doc.text('Studieplan Export', margin, 40);

  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Gegenereerd op ${new Date().toLocaleDateString('nl-NL', { dateStyle: 'long' })}`, margin, 50);

  y = 70;

  // Master study map
  writeText('Master Study Map', 14, [234, 88, 12], true);
  y += 2;
  const mapLines = plan.masterStudyMap.split('\n');
  for (const line of mapLines) {
    ensureSpace(6);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text(line, margin, y);
    y += 5;
  }

  // ── Chapters ──
  for (const topicName of topicOrder) {
    const chapters = plan.chapters.filter(ch => ch.topic === topicName);
    if (chapters.length === 0) continue;

    addPage();
    // Topic heading
    doc.setFillColor(255, 237, 213);
    doc.rect(margin - 3, y - 5, contentW + 6, 12, 'F');
    writeText(topicName, 14, [234, 88, 12], true);
    y += 4;

    for (const chapter of chapters) {
      currentChapterTitle = chapter.title;
      ensureSpace(30);

      // Chapter title
      writeText(`${chapter.id}: ${chapter.title}`, 12, [30, 30, 30], true);
      y += 1;

      // Summary
      writeText(stripMd(chapter.summary), 9, [100, 100, 100]);
      y += 2;

      // Divider
      doc.setDrawColor(230, 230, 230);
      doc.line(margin, y, pageW - margin, y);
      y += 3;

      // Content
      writeText(stripMd(chapter.content), 9, [40, 40, 40]);
      y += 6;
    }
  }

  // Footer on last page
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(`StudyFlow AI  ·  pagina ${pageNum}`, margin, pageH - 8);

  doc.save('StudyPlan.pdf');
}
