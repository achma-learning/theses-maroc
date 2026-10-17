"""Classify every thesis into the OFFICIAL FMPM specialty list (docs/liste-des-specialites-fmpm.pdf:
"Liste des spécialités — Faculté de Médecine et de Pharmacie Marrakech — option spécialité").

Three passes, each flagged in `specialiteSource` so guesses stay visible:
  1. "catalogue"  : the library category, mapped to the official name. Mixed library categories
                    ("Chirurgie", "Urologie-Nephrologie", "Neurologie"...) are split with title keywords.
  2. "rapporteur" : no library category, but the rapporteur's other theses point clearly to one
                    official specialty (>= 3 theses, >= 60 %).
  3. "titre"      : (a) an unambiguous medical word in the title (OBVIOUS list), else (b) a Naive
                    Bayes model trained on passes 1-2 reads the title (+ keywords, rapporteur), kept only
                    when confident; `specialiteConfiance` stores its probability.
The library's own `category` field is never modified.
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter, defaultdict

# --------------------------------------------------------------------------- official list
GROUPS = {
    "Spécialités de médecine": [
        "Anesthésie-Réanimation", "Cardiologie", "Dermatologie", "Endocrinologie et Maladies Métaboliques",
        "Gastro-entérologie", "Hématologie clinique", "Médecine interne", "Médecine nucléaire",
        "Médecine physique et réadaptation fonctionnelle", "Médecine communautaire", "Maladies infectieuses",
        "Médecine légale", "Néphrologie", "Neurologie", "Oncologie médicale", "Pédiatrie", "Psychiatrie",
        "Pédopsychiatrie", "Pneumo-phtisiologie", "Radiologie", "Radiothérapie", "Réanimation médicale",
        "Rhumatologie"],
    "Spécialités de chirurgie": [
        "Chirurgie cardio-vasculaire", "Chirurgie vasculaire périphérique", "Chirurgie générale",
        "Chirurgie pédiatrique", "Chirurgie réparatrice", "Chirurgie thoracique", "Gynécologie-Obstétrique",
        "Médecine d'urgence et de catastrophes", "Neurochirurgie", "Ophtalmologie", "Oto-rhino-laryngologie",
        "Urologie", "Traumatologie-orthopédie", "Stomatologie et chirurgie maxillo-faciale"],
    "Spécialités de biologie": [
        "Anatomie pathologique", "Analyses biologiques médicales", "Biochimie", "Génétique", "Pharmacologie"],
}
GROUP_OF = {s: g for g, specs in GROUPS.items() for s in specs}
UNCLASSIFIED = "Non classée"

TITLE_THRESHOLD = 0.9  # title-only cross-validation: ~82 % precision at 0.9 vs ~73 % at 0.6 (see CONTEXT.md)


def norm(s: str) -> str:
    s = re.sub(r"[̀-ͯ]", "", unicodedata.normalize("NFD", s or "")).lower()
    return re.sub(r"[’`]", "'", s)


def prof_key(name: str) -> str:
    n = norm(name).upper()
    n = re.sub(r"^\s*(PR|PROFESSEUR|DR)\.?\s+", "", n)
    n = re.sub(r"\.\s*", ". ", n)
    return re.sub(r"\s+", " ", n).strip()


# --------------------------------------------------------------------------- title keyword rules
# Used ONLY to split a library category that covers several official specialties.
# Patterns run on the accent-free, lower-case title. First match wins.
R = {
    "child": r"\benfant|pediatri|nourrisson|neonat|nouveau-ne|\bnne?\b|adolescen|infantile|juvenile|congenital",
    "neurosurg": r"neurochir|hydrocephal|meningiome|hernie discale|traumatisme? cranien|crani|hematome (sous|extra)[- ]dural|"
                 r"tumeurs? (cerebrale|intracranienne|medullaire)|rachi|medullaire|glioblastome|gliome|adenome hypophysaire|"
                 r"spondylolisthesis|canal (lombaire|carpien)|anevrisme",
    "thoracic": r"thoraci|pleur|mediastin|pneumothorax|kyste hydatique du poumon|pulmonaire.{0,20}chirurg|lobectomie|"
                r"pneumonectomie|trachea|oesophag",
    "cardiovasc": r"cardiaque.{0,20}chirurg|chirurg.{0,30}cardiaque|valv|pontage|aort|coronar|cardiopathie congenitale|"
                  r"circulation extracorporelle",
    "vascular": r"vasculaire|arteri|anevrisme|varic|ischemie aigue|fistule arterio|carotid|thrombose veineuse",
    "plastic": r"brul|reparatrice|plastique|lambeau|esthetique|cicatric|greffe de peau",
    "maxillo": r"maxillo|mandibul|faciale|fente labio|palatin|odonto|dentaire|stomatolog|cavite buccale|levre",
    "nephro": r"dialys|nephr|glomerul|insuffisance renale|greffe renale|transplant|lupique|rein\b|renale",
    "radiother": r"radiotherap|curietherap|irradiation|radio-?chimiotherap|dosimetr",
    "nuclear": r"scintigraph|nucleaire|\btep\b|tep-scan|iode radioactif|irathérapie|iratherap|radio-?iode",
    "pedopsy": r"enfant|adolescen|autis|hyperactivit|tdah|scolaire|juvenile",
    "rheumato": r"rhumat|spondylarthrite|polyarthrite|goutte|arthrose|osteoporose|sacro-?ili",
    "rehab": r"reeducation|readaptation|kinesitherap|handicap",
    "legal": r"medico-?legal|autopsie|medecine legale|thanatolog|levee de corps",
    "genetic": r"genet|caryotyp|chromosom|mutation|cytogenet|trisomie|consanguin",
    "icu": r"reanimation medicale",
}


def has(key: str, title: str) -> bool:
    return re.search(R[key], title) is not None


def split_catalogue(cat: str, title_raw: str) -> str | None:
    """Library category (last level) + title -> official specialty, or None if not mappable."""
    c = norm(cat).replace("-", " ").strip()
    c = re.sub(r"\s+", " ", c)
    t = norm(title_raw)
    if c == "chirurgie":
        if has("child", t): return "Chirurgie pédiatrique"
        if has("neurosurg", t): return "Neurochirurgie"
        if has("cardiovasc", t): return "Chirurgie cardio-vasculaire"
        if has("thoracic", t): return "Chirurgie thoracique"
        if has("vascular", t): return "Chirurgie vasculaire périphérique"
        if has("plastic", t): return "Chirurgie réparatrice"
        if has("maxillo", t): return "Stomatologie et chirurgie maxillo-faciale"
        return "Chirurgie générale"
    if c == "neurologie":
        return "Neurochirurgie" if has("neurosurg", t) else "Neurologie"
    if c == "urologie nephrologie":
        return "Néphrologie" if has("nephro", t) and not re.search(r"lithiase|prostat|vessie|ureter|uretr|testic|"
                                                                  r"cancer du rein|nephrectomie|nephrolithotomie", t) else "Urologie"
    if c == "pediatrie":
        if re.search(r"chirurg|fracture|appendic|invagination|hypospad|cryptorchid|hernie|stenose du pylore|"
                     r"malformation anorectale|atresie|megacolon|hirschsprung|torsion|traumatism|osteomyelite|"
                     r"luxation congenitale|pied bot|brul", t):
            return "Chirurgie pédiatrique"
        if re.search(r"autis|hyperactivit|tdah|psychi|depress|anxi|comportement", t):
            return "Pédopsychiatrie"
        return "Pédiatrie"
    if c == "psychiatrie":
        return "Pédopsychiatrie" if has("pedopsy", t) else "Psychiatrie"
    if c == "pneumologie":
        return "Chirurgie thoracique" if re.search(r"chirurg|lobectomie|pneumonectomie|thoracotomie|"
                                                    r"kyste hydatique", t) else "Pneumo-phtisiologie"
    if c == "radiologie":
        return "Médecine nucléaire" if has("nuclear", t) else "Radiologie"
    if c in ("oncologie", "cancerologie"):
        if has("radiother", t): return "Radiothérapie"
        if has("nuclear", t): return "Médecine nucléaire"
        return "Oncologie médicale"
    if c == "traumatologie orthopedie":
        if has("rehab", t): return "Médecine physique et réadaptation fonctionnelle"
        if has("rheumato", t) and not re.search(r"prothese|chirurg|fracture|arthroplast|osteotomie|arthroscop|ligament", t):
            return "Rhumatologie"
        return "Traumatologie-orthopédie"
    if c == "anesthesie reanimation":
        return "Réanimation médicale" if has("icu", t) else "Anesthésie-Réanimation"
    if c == "medecine interne":
        return "Rhumatologie" if has("rheumato", t) else "Médecine interne"
    if c == "orl":
        return "Stomatologie et chirurgie maxillo-faciale" if re.search(r"maxillo|mandibul|fente labio|palatin|dentaire", t) \
            else "Oto-rhino-laryngologie"
    if c in ("histologie embryologie",):
        return "Génétique" if has("genetic", t) else "Analyses biologiques médicales"
    if c == "sante publique":
        return "Médecine légale" if has("legal", t) else "Médecine communautaire"
    direct = {
        "cardiologie": "Cardiologie", "dermatologie": "Dermatologie",
        "endocrinologie": "Endocrinologie et Maladies Métaboliques", "gastro enterologie": "Gastro-entérologie",
        "hematologie": "Hématologie clinique", "maladies infectieuses": "Maladies infectieuses",
        "gynecologie obstetrique": "Gynécologie-Obstétrique", "ophtalmologie": "Ophtalmologie",
        "odonto stomatologie": "Stomatologie et chirurgie maxillo-faciale", "urgence": "Médecine d'urgence et de catastrophes",
        "anatomie pathologique": "Anatomie pathologique", "biochimie": "Biochimie", "pharmacologie": "Pharmacologie",
        "medecine therapeutique": "Pharmacologie", "microbiologie": "Analyses biologiques médicales",
        "bacteriologie": "Analyses biologiques médicales", "parasitologie": "Analyses biologiques médicales",
        "virologie": "Analyses biologiques médicales", "immunologie": "Analyses biologiques médicales",
        "biologie": "Analyses biologiques médicales",
    }
    return direct.get(c)  # anatomie, physiologie, biophysique: not in the official list -> title model decides


# Unambiguous title words, tried before the statistical model (pass 3a). Keep this list short and
# only add terms that belong to ONE official specialty whatever the context.
OBVIOUS = [
    ("Ophtalmologie", r"cornee|retin|cataracte|glaucome|uveite|strabisme|keratit|oculaire|orbitaire|paupiere|vitre"),
    ("Hématologie clinique", r"myelome|lymphome|leucemie|hemophil|drepanocyt|thalassemi|aplasie medullaire|myelodysplas"),
    ("Dermatologie", r"psoriasis|pemphig|dermato|vitiligo|acne|melanome cutane|eczema|alopecie|leishmaniose cutanee"),
    ("Cardiologie", r"infarctus du myocarde|insuffisance cardiaque|fibrillation atriale|endocardite|pericardite|coronarien"),
    ("Gynécologie-Obstétrique", r"grossesse|cesarienne|accouchement|placenta|post-?partum|endometr|col uterin|contracepti"),
    ("Médecine communautaire", r"tabagisme|milieu scolaire|collegien|lyceen|vaccination|sante publique|epidemiologie descriptive"),
    ("Psychiatrie", r"schizophren|bipolaire|depression|toxicomanie|addiction|suicid|psychotrope"),
    ("Néphrologie", r"hemodialys|dialyse peritoneale|nephropathie|glomerulo"),
    ("Pneumo-phtisiologie", r"asthme|bpco|tuberculose pulmonaire|allergologie|pneumopathie|apnee du sommeil"),
    ("Endocrinologie et Maladies Métaboliques", r"diabet|thyroidite|hypothyroid|hyperthyroid|basedow|cushing|surrenal"),
]


# --------------------------------------------------------------------------- Naive Bayes on titles
STOP = set("le la les des du de d l et en au aux une un chez sur dans par pour avec sans propos cas the of and in "
           "an to on at from service chu marrakech mohammed med vi experience etude hopital militaire avicenne "
           "ibn tofail nafis prise charge".split())


def features(t: dict) -> list[str]:
    words = [w[:7] for w in re.findall(r"[a-z]{3,}", norm(t.get("title", "") + " " + " ".join(t.get("tags") or [])))
             if w not in STOP]  # w[:7] = crude stemming: pediatrique / pediatrie -> pediatr
    f = words + [a + "_" + b for a, b in zip(words, words[1:])]
    if t.get("rapporteur"):
        f += ["RAPP:" + prof_key(t["rapporteur"])] * 3  # a rapporteur is a strong hint, count it 3x
    return f


class NaiveBayes:
    def __init__(self, rows: list[tuple[dict, str]]):
        self.cc, self.wc, vocab = Counter(), defaultdict(Counter), set()
        for t, label in rows:
            self.cc[label] += 1
            for f in features(t):
                self.wc[label][f] += 1
                vocab.add(f)
        self.tot = {c: sum(self.wc[c].values()) for c in self.cc}
        self.V, self.N = len(vocab), sum(self.cc.values())

    def predict(self, t: dict) -> tuple[str, float]:
        fs = features(t)
        score = {c: math.log(self.cc[c] / self.N) +
                 sum(math.log((self.wc[c][f] + 0.5) / (self.tot[c] + 0.5 * self.V)) for f in fs) for c in self.cc}
        top = max(score.values())
        p = {c: math.exp(v - top) for c, v in score.items()}
        best = max(p, key=p.get)
        return best, p[best] / sum(p.values())


# --------------------------------------------------------------------------- main entry
def classify_all(data: list[dict]) -> Counter:
    """Set specialite / groupe / specialiteSource (/ specialiteConfiance) on every record."""
    for t in data:
        for k in ("specialite", "groupe", "specialiteSource", "specialiteConfiance"):
            t.pop(k, None)
        # older runs wrote rapporteur guesses into the library field: undo, it belongs to the library
        if t.get("categorySource") == "rapporteur":
            t["category"] = None
        t.pop("categorySource", None)

    # pass 1: library category
    for t in data:
        cat = t.get("category")
        if isinstance(cat, list) and len(cat) >= 3:
            s = split_catalogue(cat[-1], t.get("title", ""))
            if s:
                t["specialite"], t["specialiteSource"] = s, "catalogue"

    # pass 2: rapporteur history
    hist: dict[str, Counter] = defaultdict(Counter)
    for t in data:
        if t.get("specialiteSource") == "catalogue" and t.get("rapporteur"):
            hist[prof_key(t["rapporteur"])][t["specialite"]] += 1
    for t in data:
        if t.get("specialite") or not t.get("rapporteur"):
            continue
        h = hist.get(prof_key(t["rapporteur"]))
        if h:
            spec, n = h.most_common(1)[0]
            if sum(h.values()) >= 3 and n / sum(h.values()) >= 0.6:
                t["specialite"], t["specialiteSource"] = spec, "rapporteur"

    # pass 3a: unambiguous words in the title
    for t in data:
        if t.get("specialite"):
            continue
        title = norm(t.get("title", ""))
        for spec, rx in OBVIOUS:
            if re.search(rx, title):
                t["specialite"], t["specialiteSource"] = spec, "titre"
                break

    # pass 3b: title model trained on everything labelled so far
    labelled = [(t, t["specialite"]) for t in data if t.get("specialite")]
    model = NaiveBayes(labelled) if labelled else None
    for t in data:
        if t.get("specialite") or model is None:
            continue
        spec, p = model.predict(t)
        if p >= TITLE_THRESHOLD:
            t["specialite"], t["specialiteSource"], t["specialiteConfiance"] = spec, "titre", round(p, 2)

    for t in data:
        t["groupe"] = GROUP_OF.get(t.get("specialite"), UNCLASSIFIED)
        t.setdefault("specialite", UNCLASSIFIED)
    return Counter(t.get("specialiteSource", "none") for t in data)


def cross_validate(data: list[dict], folds: int = 5) -> list[tuple[float, bool]]:
    """(probability, correct) for every catalogue-labelled thesis, from the title alone (no keywords, no rapporteur),
    i.e. the hardest case: what pass 3 faces for 2025-2026 theses."""
    import random
    rows = [t for t in data if t.get("specialiteSource") == "catalogue"]
    random.Random(1).shuffle(rows)
    out = []
    for i in range(folds):
        model = NaiveBayes([(t, t["specialite"]) for j, t in enumerate(rows) if j % folds != i])
        for t in rows[i::folds]:
            spec, p = model.predict({"title": t["title"]})
            out.append((p, spec == t["specialite"]))
    return out
