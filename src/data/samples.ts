// Milestone D — a REAL representative SpecSheet, transcribed from the actual Peugeot 3008
// MHEV brochure spec page (p13) + equipment page (p15). It grounds the canonical CSV/Excel
// template in real data (so the downloadable template matches the user's brochures) and
// drives the headless round-trip gate. Values are the real ones read from the source PDF;
// where a figure is shared across trims it broadcasts (single value), consumption is per-trim.
import { type SpecSheet, normalizeSheet } from './specModel';

export function peugeot3008Sheet(): SpecSheet {
  return normalizeSheet({
    brand: 'פיג׳ו',
    model: '3008',
    trims: ['GT', 'ALLURE'],
    sections: [
      {
        title: 'מנוע בנזין',
        rows: [
          { label: 'סוג מנוע', values: ['MHEV בנזין'] },
          { label: 'נפח מנוע', unit: 'סמ״ק', values: ['1,199'] },
          { label: 'מספר בוכנות', values: ['3'] },
          { label: 'מספר שסתומים', values: ['12'] },
          { label: 'הספק מירבי', unit: 'כ״ס/סל״ד', values: ['136/5500'] },
          { label: 'מומנט מירבי', unit: 'קג״מ/סל״ד', values: ['23.4/1750'] },
          { label: 'מגדש טורבו', values: ['•'] },
          { label: 'מערכת START&STOP', values: ['•'] },
        ],
      },
      {
        title: 'מנוע חשמלי',
        rows: [
          { label: 'הספק מירבי חשמל', unit: 'כ״ס', values: ['22'] },
          { label: 'מומנט מירבי', unit: 'קג״מ', values: ['5.2'] },
        ],
      },
      {
        title: 'הספק משולב',
        rows: [{ label: 'הספק מירבי משולב', unit: 'כ״ס', values: ['145'] }],
      },
      {
        title: 'סוללה',
        rows: [
          { label: 'סוג סוללה', values: ['LITHIUM-ION'] },
          { label: 'מתח', unit: 'וולט', values: ['48'] },
          { label: 'קיבולת סוללה', unit: 'קוט״ש', values: ['0.89'] },
          { label: 'אחריות סוללה', values: ['3 שנים או 100,000 ק״מ'] },
        ],
      },
      {
        title: 'תצרוכת דלק (ליטר ל-100 ק״מ)',
        rows: [
          { label: 'נהיגה במהירות נמוכה', values: ['5.2', '5.1'] },
          { label: 'נהיגה במהירות גבוהה', values: ['4.9', '4.8'] },
          { label: 'נתון צריכה משולב', values: ['5.6', '5.5'] },
        ],
      },
      {
        title: 'ביצועים לפי נתוני היצרן',
        rows: [
          { label: 'מהירות מירבית', unit: 'קמ״ש', values: ['201'] },
          { label: 'תאוצה מ-0 ל-100 קמ״ש', unit: 'שניות', values: ['10.2'] },
        ],
      },
      { title: 'צמיגים', rows: [{ label: 'מידת צמיגים', values: ['225/55R19'] }] },
      {
        title: 'מידות (ס״מ)',
        rows: [
          { label: 'אורך כללי', values: ['453.5'] },
          { label: 'רוחב כללי', values: ['189'] },
          { label: 'גובה', values: ['166.5'] },
          { label: 'בסיס גלגלים', values: ['273'] },
          { label: 'מרווח גחון', values: ['19.57'] },
        ],
      },
      {
        title: 'משקל (ק״ג)',
        rows: [
          { label: 'משקל עצמי (לא כולל נהג)', values: ['1,573'] },
          { label: 'משקל כולל מורשה', values: ['2,080'] },
        ],
      },
      {
        title: 'כושר גרירה מרבי (ק״ג)',
        rows: [
          { label: 'נגרר ללא בלמים', values: ['750'] },
          { label: 'נגרר עם בלמים', values: ['1000'] },
        ],
      },
    ],
    features: [
      {
        title: 'בטיחות',
        items: [
          { label: '6 כריות אוויר', perTrim: [true, true] },
          { label: 'ESP – מערכת בקרת יציבות אלקטרונית', perTrim: [true, true] },
          { label: 'ABS – מערכת למניעת נעילת הגלגלים', perTrim: [true, true] },
          { label: 'EBA – מערכת לתגבור בלימה בשעת חירום', perTrim: [true, true] },
          { label: 'TPMS – זיהוי לחץ אוויר נמוך בצמיגים', perTrim: [true, true] },
        ],
      },
      {
        title: 'בטיחות אקטיבית',
        items: [
          { label: 'מערכת בלימת חירום אקטיבית', perTrim: [true, true] },
          { label: 'התרעה לסטייה מנתיב', perTrim: [true, true] },
          { label: 'זיהוי תמרורי מהירות', perTrim: [true, true] },
          { label: 'התרעה על רכב בשטח המת', perTrim: [true, false] },
          { label: 'מצלמת חנייה 360°', perTrim: [true, false] },
        ],
      },
      {
        title: 'נהיגה ונוחות',
        items: [
          { label: '3 מצבי נהיגה לבחירת הנהג', perTrim: [true, true] },
          { label: 'חיישני חנייה היקפיים', perTrim: [true, true] },
          { label: 'בקרת אקלים מפוצלת', perTrim: [true, true] },
          { label: 'משטח טעינה אלחוטי לנייד', perTrim: [true, false] },
        ],
      },
    ],
    colors: [
      { name: 'לבן פנינה', type: 'pearl', code: '#f3f4f6' },
      { name: 'אפור פלטינום', type: 'metallic', code: '#9aa0a6' },
      { name: 'שחור פרל', type: 'metallic', code: '#1d1f22' },
      { name: 'כחול אוביסידיאן', type: 'metallic', code: '#1f3a5f' },
      { name: 'אדום אלחי', type: 'metallic', code: '#8c1c1c' },
    ],
    wheels: [
      { label: 'חישוקי סגסוגת קלה', size: '19"' },
      { label: 'חישוקי סגסוגת קלה', size: '18"' },
    ],
    marketingText: 'פיג׳ו 3008 החדשה — קופה SUV עם תא נוסעים i-Cockpit, מנוע MHEV חסכוני וטכנולוגיות בטיחות מתקדמות.',
    legalText: 'נתוני צריכת הדלק והחשמל הינם בהתאם לבדיקות מעבדה ונתוני היצרן. ייתכנו הבדלים בפועל. ט.ל.ח.',
    price: 'החל מ-₪199,900',
  });
}
