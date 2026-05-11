# Backend

Αυτός είναι ο κεντρικός φάκελος του backend. Εδώ φιλοξενείται ολόκληρη η λογική του διακομιστή (FastAPI).

## Αρχεία σε αυτόν τον φάκελο:
- `requirements.txt`: Λίστα με τις βιβλιοθήκες Python (όπως `fastapi`, `supabase`, `azure-ai-projects`) που χρειάζονται για να τρέξει το backend.
- `Dockerfile`: Οι οδηγίες για τη δημιουργία της εικόνας Docker (Docker image) του backend, χρήσιμο για την ανάπτυξη (deployment) της εφαρμογής σε πλατφόρμες όπως Render ή Azure Container Apps.
- `.env.example`: Πρότυπο αρχείο με τις περιβαλλοντικές μεταβλητές. Εκεί μπαίνουν τα κλειδιά για το Supabase και το Azure AI, και το URL του frontend (για το CORS).
- `venv/`: (Εάν υπάρχει) Είναι το εικονικό περιβάλλον (Virtual Environment) της Python, στο οποίο εγκαθίστανται τα πακέτα. Δεν αποθηκεύεται στον έλεγχο εκδόσεων (π.χ. Git).
- `app/`: Ο φάκελος που περιέχει τον πηγαίο κώδικα (source code) του FastAPI.
- `README.md`: Αυτό το αρχείο.
