"""Pruebas sin navegador del lector de estadísticas de grupos de Facebook."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "browser-stats"))
from group_parser import parse_count, group_numbers  # noqa: E402


class GroupParserTests(unittest.TestCase):
    def test_etiqueta_antes_de_numero(self):
        self.assertEqual(
            group_numbers("Miembros nuevos\n12\nMiembros activos\n37\nPublicaciones\n4"),
            {"newMembers": 12, "activeMembers": 37, "posts": 4},
        )

    def test_numero_antes_de_etiqueta(self):
        self.assertEqual(
            group_numbers("0 comentarios\n7 reacciones\n3 Nuevos miembros"),
            {"comments": 0, "reactions": 7, "newMembers": 3},
        )

    def test_miles_con_punto_o_coma(self):
        self.assertEqual(parse_count("1.234"), 1234)
        self.assertEqual(parse_count("1,2 mil"), 1200)
        self.assertIsNone(parse_count("sin datos"))

    def test_lectura_parcial_y_cero_real(self):
        self.assertEqual(group_numbers("Comentarios: 0\nTexto sin número"), {"comments": 0})

    def test_no_inventa_datos(self):
        self.assertEqual(group_numbers("Publicaciones\nNo disponibles"), {})


if __name__ == "__main__":
    unittest.main()
