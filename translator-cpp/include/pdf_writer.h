#pragma once

#include "wall.h"
#include <string>
#include <vector>

namespace eficiencia {

/// Paper size dimensions in mm.
struct PaperSize {
    std::string name;
    double width_mm;
    double height_mm;
};

inline PaperSize paper_a3() { return {"A3", 420.0, 297.0}; }
inline PaperSize paper_a1() { return {"A1", 841.0, 594.0}; }

/// Writes walls to a minimal PDF file with dimension annotations.
/// Uses raw PDF operators — no external library dependency.
class PdfWriter {
public:
    void write(const std::vector<Wall>& walls,
               const std::string& output_path,
               int scale_denom = 100,
               PaperSize paper = paper_a3()) const;

private:
    /// Convert metres to PDF points at given scale.
    /// 1 m at 1:1 = 1000 mm = 1000/25.4*72 points.
    static double m_to_pts(double m, int scale_denom);

    /// Build the page content stream.
    std::string build_content(const std::vector<Wall>& walls,
                              int scale_denom,
                              const PaperSize& paper) const;
};

} // namespace eficiencia
