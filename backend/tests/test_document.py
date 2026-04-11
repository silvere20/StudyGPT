from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.document import detect_document_type  # noqa: E402

# ── Representatieve markdown snippets per type ────────────────────────────────

SLIDES_MD = """\
## Slide 1
- Introductie tot Statistiek
- Wat is een kansverdeling?

Slide 2
- Normale verdeling
- Gemiddelde en standaarddeviatie

--- 3 ---
- Centrale limietstelling
- Toepassingen in de praktijk

Slide 4
- Hypothesetoetsing
- p-waarde interpretatie

Slide 5
- Betrouwbaarheidsintervallen
- t-toets
"""

SLIDES_SHORT_LINE_MD = "\n".join(
    [f"## Punt {i}\n- Item A\n- Item B\n- Item C" for i in range(15)]
)

SCHEDULE_MD = """\
| Week | Datum | Onderwerp | Deadline |
|------|-------|-----------|----------|
| 1 | 03/02/2025 | Introductie kansrekening | — |
| 2 | 10/02/2025 | Verdelingsfuncties | — |
| 3 | 17/02/2025 | Steekproeven | Opdracht 1 inleveren |
| 4 | 24/02/2025 | Toetsing | — |
| 5 | 03/03/2025 | Regressie | Opdracht 2 inleveren |
| 6 | 10/03/2025 | Tijdreeksen | — |
| 7 | 17/03/2025 | Herhaling | Tentamen 24/03/2025 |

Deadline paper: 15/03/2025
Week 8: tentamen — 24-03-2025
"""

FORMULA_SHEET_MD = """\
## Kansrekening

$P(A \\cup B) = P(A) + P(B) - P(A \\cap B)$

$P(A|B) = \\frac{P(A \\cap B)}{P(B)}$

## Normale Verdeling

$$f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$$

$Z = \\frac{X - \\mu}{\\sigma}$

## Regressie

$$\\hat{\\beta} = (X^T X)^{-1} X^T y$$

$R^2 = 1 - \\frac{SS_{res}}{SS_{tot}}$

## Betrouwbaarheidsinterval

$\\bar{x} \\pm z_{\\alpha/2} \\cdot \\frac{\\sigma}{\\sqrt{n}}$

$t = \\frac{\\bar{x} - \\mu_0}{s / \\sqrt{n}}$
"""

EXAM_MD = """\
# Tentamen Statistiek — Januari 2025

Naam: ___________  Studentnummer: ___________

**Totaal: 60 punten**

Vraag 1 (8 punten)
Bereken het gemiddelde en de standaarddeviatie van de volgende dataset: 4, 7, 13, 2, 1.

Vraag 2 (12 punten)
Een steekproef van n=50 heeft gemiddelde 23 en standaarddeviatie 5.
(a) Bereken een 95%-betrouwbaarheidsinterval voor het populatiegemiddelde. (6 p.)
(b) Toets H0: μ=25 op significantieniveau α=0.05. (6 p.)

Vraag 3 (10 punten)
Welke uitspraak is correct over de p-waarde?
(a) De kans dat H0 waar is
(b) De kans op de gevonden uitkomst gegeven H0 klopt
(c) Het significantieniveau
(d) De power van de toets

Vraag 4 (6 punten)
Leg uit wat Type I en Type II fouten zijn. (3 p.) elk
"""

ARTICLE_MD = """\
## Abstract

This study examines the relationship between study hours and academic performance
in higher education institutions. Previous research has shown mixed results
(Smith et al., 2019; Johnson & Lee, 2021). We collected data from 500 students
across three universities and applied multilevel regression analysis.

## Introduction

Academic performance has been widely studied in educational psychology (Brown, 2018).
Several theories suggest that deliberate practice (Ericsson et al., 1993) plays
a central role. However, contextual factors such as socioeconomic status (Williams, 2020)
and prior knowledge (Davis & Martinez, 2022) must be controlled for.

## Methodology

Participants completed a structured questionnaire measuring weekly study hours,
attendance rates, and self-reported motivation. Linear regression models were
fitted using SPSS 27 (Field, 2018). All analyses controlled for baseline GPA
and demographic variables (Chen et al., 2021).

## Results

Students who studied more than 20 hours per week scored significantly higher
(M=7.4, SD=0.9) than those studying fewer than 10 hours (M=5.8, SD=1.2),
t(498)=14.3, p<.001 (Anderson & Taylor, 2023).

## References

Anderson, J., & Taylor, R. (2023). Study habits and outcomes. *Journal of Education*, 45(2), 112–130.
Brown, K. (2018). *Learning science fundamentals*. Oxford University Press. [1]
"""

TEXTBOOK_MD = """\
# Hoofdstuk 4: Lineaire Regressie

## 4.1 Inleiding

Lineaire regressie is een statistische methode waarmee we de relatie tussen een
afhankelijke variabele en een of meer onafhankelijke variabelen modelleren. Het
model gaat ervan uit dat deze relatie lineair van aard is, wat betekent dat een
eenheidstoename in de predictor leidt tot een constante verandering in de uitkomst.

DEFINITIE: Het enkelvoudig lineair regressiemodel is gedefinieerd als:
$Y = \\beta_0 + \\beta_1 X + \\varepsilon$
waarbij $\\varepsilon \\sim N(0, \\sigma^2)$ de foutterm is.

## 4.2 Kleinste-kwadratenmethode

De parameters $\\beta_0$ en $\\beta_1$ worden geschat door de som van de
gekwadrateerde residuen te minimaliseren. Dit levert de volgende schattingen op:

$$\\hat{\\beta}_1 = \\frac{\\sum_{i=1}^n (x_i - \\bar{x})(y_i - \\bar{y})}{\\sum_{i=1}^n (x_i - \\bar{x})^2}$$

VOORBEELD: Stel dat we het verband willen modelleren tussen het aantal studie-uren
(X) en het tentamencijfer (Y). Met de volgende data: (2,5), (4,6), (6,7), (8,9)
berekenen we eerst de gemiddelden: $\\bar{x}=5$, $\\bar{y}=6.75$.

## 4.3 Modeldiagnose

Na het schatten van het model moeten we controleren of de aannames zijn voldaan.
De vier kernassumpties van het lineair regressiemodel zijn: lineariteit,
homoscedasticiteit, normaliteit van de residuen, en onafhankelijkheid.
"""

MIXED_MD = """\
## Inleiding

Dit document bevat een mix van materiaal voor de cursus Wiskunde B.
Hieronder vind je zowel theorie als enkele oefeningen.

## Theorie: Afgeleiden

De afgeleide van een functie geeft de veranderingssnelheid aan.

$f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$

## Oefening

Bereken de afgeleide van $f(x) = x^3 + 2x$.
"""


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_detects_slides_by_slide_numbers():
    result = detect_document_type(SLIDES_MD, "hoorcollege_week1.pdf")
    assert result == "slides"


def test_detects_slides_by_pptx_extension():
    result = detect_document_type("## Slide content\n- bullet", "presentatie.pptx")
    assert result == "slides"


def test_detects_slides_by_short_line_ratio():
    result = detect_document_type(SLIDES_SHORT_LINE_MD, "college.pdf")
    assert result == "slides"


def test_detects_schedule_by_dates_and_tables():
    result = detect_document_type(SCHEDULE_MD, "cursusrooster.pdf")
    assert result == "schedule"


def test_detects_schedule_by_filename_keyword():
    result = detect_document_type("Week 1: inleiding", "rooster_2025.pdf")
    assert result == "schedule"


def test_detects_formula_sheet_by_math_density():
    result = detect_document_type(FORMULA_SHEET_MD, "formules.pdf")
    assert result == "formula_sheet"


def test_detects_formula_sheet_by_filename_keyword():
    result = detect_document_type("$x^2 + y^2 = r^2$", "formulier_referentie.pdf")
    assert result == "formula_sheet"


def test_detects_exam_by_questions_and_points():
    result = detect_document_type(EXAM_MD, "tentamen_jan2025.pdf")
    assert result == "exam"


def test_detects_exam_by_filename_keyword():
    result = detect_document_type("Vraag 1: bereken x.", "toets_week3.pdf")
    assert result == "exam"


def test_detects_article_by_citations_and_prose():
    result = detect_document_type(ARTICLE_MD, "paper.pdf")
    assert result == "article"


def test_detects_textbook_by_long_prose():
    result = detect_document_type(TEXTBOOK_MD, "statistiek_boek.pdf")
    assert result == "textbook"


def test_detects_mixed_for_short_uncategorised():
    result = detect_document_type(MIXED_MD, "notities.pdf")
    assert result == "mixed"


def test_filename_exam_overrides_content():
    # Even with barely any exam markers in content, filename should win
    result = detect_document_type("Korte tekst.", "tentamen_2024.pdf")
    assert result == "exam"


def test_empty_content_returns_mixed():
    result = detect_document_type("", "unknown.pdf")
    assert result == "mixed"


def test_detects_slides_bracket_page_numbers():
    md = "## Inleiding\n[1 / 20]\n- punt\n[2 / 20]\n- punt\n[3 / 20]\n- punt\n"
    result = detect_document_type(md, "slides.pdf")
    assert result == "slides"
