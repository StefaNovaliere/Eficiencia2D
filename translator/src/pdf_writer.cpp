#include "pdf_writer.h"

#include <cmath>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace eficiencia {

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

double PdfWriter::m_to_pts(double m, int scale_denom) {
    // At 1:1, 1 m = 1000 mm.  1 mm = 72/25.4 pt.
    return (m / scale_denom) * 1000.0 * (72.0 / 25.4);
}

// ---------------------------------------------------------------------------
// Content stream builder
// ---------------------------------------------------------------------------

std::string PdfWriter::build_content(const std::vector<Wall>& walls,
                                      int scale_denom,
                                      const PaperSize& paper) const {
    std::ostringstream cs;
    cs << std::fixed << std::setprecision(4);

    double margin_pts = 30.0; // ~10 mm margin
    double gap_pts = m_to_pts(1.5, scale_denom);
    double cursor_x = margin_pts;
    double page_h_pts = paper.height_mm * (72.0 / 25.4);

    for (const auto& wall : walls) {
        double w_pts = m_to_pts(wall.width, scale_denom);
        double h_pts = m_to_pts(wall.height, scale_denom);

        // Baseline Y: center vertically on the page.
        double base_y = (page_h_pts - h_pts) / 2.0;

        // --- Draw outer boundary ---
        cs << "0.3 w\n"; // line width
        const auto& ov = wall.outer.vertices;
        if (!ov.empty()) {
            auto tx = [&](double vx) { return cursor_x + m_to_pts(vx, scale_denom); };
            auto ty = [&](double vy) { return base_y   + m_to_pts(vy, scale_denom); };

            cs << tx(ov[0].x) << " " << ty(ov[0].y) << " m\n";
            for (size_t i = 1; i < ov.size(); ++i)
                cs << tx(ov[i].x) << " " << ty(ov[i].y) << " l\n";
            cs << "s\n"; // close & stroke
        }

        // --- Draw openings (dashed) ---
        cs << "[4 2] 0 d\n"; // dash pattern
        for (const auto& opening : wall.openings) {
            const auto& iv = opening.vertices;
            if (iv.empty()) continue;
            auto tx = [&](double vx) { return cursor_x + m_to_pts(vx, scale_denom); };
            auto ty = [&](double vy) { return base_y   + m_to_pts(vy, scale_denom); };

            cs << tx(iv[0].x) << " " << ty(iv[0].y) << " m\n";
            for (size_t i = 1; i < iv.size(); ++i)
                cs << tx(iv[i].x) << " " << ty(iv[i].y) << " l\n";
            cs << "s\n";
        }
        cs << "[] 0 d\n"; // reset dash

        // --- Dimension annotations ---
        double font_size = 8.0;
        cs << "BT\n";
        // Wall label (above)
        cs << "/F1 " << font_size << " Tf\n";
        cs << cursor_x + w_pts / 2.0 << " " << base_y + h_pts + 12.0 << " Td\n";
        cs << "(" << wall.label << ") Tj\n";
        cs << "ET\n";

        // Width label (below)
        std::ostringstream wl;
        wl << std::fixed << std::setprecision(2) << wall.width << " m";
        cs << "BT\n";
        cs << "/F1 " << font_size << " Tf\n";
        cs << cursor_x + w_pts / 2.0 << " " << base_y - 14.0 << " Td\n";
        cs << "(" << wl.str() << ") Tj\n";
        cs << "ET\n";

        // Height label (right side)
        std::ostringstream hl;
        hl << std::fixed << std::setprecision(2) << wall.height << " m";
        cs << "BT\n";
        cs << "/F1 " << font_size << " Tf\n";
        cs << cursor_x + w_pts + 6.0 << " " << base_y + h_pts / 2.0 << " Td\n";
        cs << "(" << hl.str() << ") Tj\n";
        cs << "ET\n";

        cursor_x += w_pts + gap_pts;
    }

    return cs.str();
}

// ---------------------------------------------------------------------------
// PDF generation (minimal hand-written PDF)
// ---------------------------------------------------------------------------

void PdfWriter::write(const std::vector<Wall>& walls,
                      const std::string& output_path,
                      int scale_denom,
                      PaperSize paper) const {
    std::string content = build_content(walls, scale_denom, paper);

    double pw = paper.width_mm  * (72.0 / 25.4);
    double ph = paper.height_mm * (72.0 / 25.4);

    // We'll collect byte offsets for the xref table.
    std::ostringstream pdf;
    pdf << std::fixed;

    // Header
    pdf << "%PDF-1.4\n";

    // Object 1: Catalog
    std::vector<size_t> offsets;
    offsets.push_back(pdf.tellp());
    pdf << "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";

    // Object 2: Pages
    offsets.push_back(pdf.tellp());
    pdf << "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";

    // Object 3: Page
    offsets.push_back(pdf.tellp());
    pdf << "3 0 obj\n<< /Type /Page /Parent 2 0 R"
        << " /MediaBox [0 0 " << pw << " " << ph << "]"
        << " /Contents 4 0 R"
        << " /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n";

    // Object 4: Content stream
    offsets.push_back(pdf.tellp());
    pdf << "4 0 obj\n<< /Length " << content.size() << " >>\nstream\n"
        << content
        << "endstream\nendobj\n";

    // Object 5: Font (built-in Helvetica)
    offsets.push_back(pdf.tellp());
    pdf << "5 0 obj\n<< /Type /Font /Subtype /Type1"
        << " /BaseFont /Helvetica >>\nendobj\n";

    // Xref
    size_t xref_off = pdf.tellp();
    pdf << "xref\n0 " << offsets.size() + 1 << "\n";
    pdf << "0000000000 65535 f \n";
    for (size_t off : offsets) {
        pdf << std::setw(10) << std::setfill('0') << off << " 00000 n \n";
    }

    // Trailer
    pdf << "trailer\n<< /Size " << offsets.size() + 1
        << " /Root 1 0 R >>\n";
    pdf << "startxref\n" << xref_off << "\n%%EOF\n";

    // Write to disk.
    std::ofstream ofs(output_path, std::ios::binary);
    if (!ofs)
        throw std::runtime_error("Cannot open output PDF: " + output_path);
    ofs << pdf.str();
}

} // namespace eficiencia
