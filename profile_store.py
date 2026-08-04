"""
Builds and queries a Chroma vector store over the candidate's profile data
(skills, experience, education, etc.), used to pull relevant background for
tailoring a cover letter to a specific job.
"""

import uuid

import chromadb
import pandas as pd


class ProfileStore:
    def __init__(self, csv_path: str, persist_path: str, collection_name: str = "profile"):
        self.client = chromadb.PersistentClient(persist_path)
        self.collection = self.client.get_or_create_collection(name=collection_name)
        self._load(csv_path)

    def _load(self, csv_path: str) -> None:
        if self.collection.count() > 0:
            return  # already populated

        df = pd.read_csv(csv_path)
        for _, row in df.iterrows():
            self.collection.add(
                documents=[row["Field"]],
                metadatas=[{"value": row["Value"]}],
                ids=[str(uuid.uuid4())],
            )

    def query(self, query_text: str, n_results: int = 5) -> list[str]:
        results = self.collection.query(query_texts=[query_text], n_results=n_results)
        metadatas = results.get("metadatas", [[]])[0]
        return [m["value"] for m in metadatas]
