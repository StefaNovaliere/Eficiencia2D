#include "dxf_writer.h"

#include <cmath>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace eficiencia {

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

void DxfWriter::write(const std::vector<Wall>& walls,
                      const std::string& output_path,
                      int scale_denom) const {
    std::ofstream ofs(output_path);
    if (!ofs)
        throw std::runtime_error("Cannot open output DXF: " + output_path);

    write_header(ofs);

    // Layout walls side by side with a gap.
    constexpr double kGapMetres = 2.0;
    double offset_x = 0.0;

    for (const auto& wall : walls) {
        write_wall(ofs, wall, offset_x, scale_denom);
        offset_x += wall.width + kGapMetres;
    }

    write_footer(ofs);
}

// ---------------------------------------------------------------------------
// DXF skeleton
// ---------------------------------------------------------------------------

void DxfWriter::write_header(std::ostream& os) const {
    os << "0\nSECTION\n2\nHEADER\n"
       << "9\n$ACADVER\n1\nAC1015\n"       // AutoCAD 2000 compat
       << "9\n$INSUNITS\n70\n6\n"           // metres
       << "0\nENDSEC\n";

    // Tables section with minimal layer definitions.
    os << "0\nSECTION\n2\nTABLES\n"
       << "0\nTABLE\n2\nLAYER\n70\n3\n"
       << "0\nLAYER\n2\nWALLS\n70\n0\n62\n7\n6\nCONTINUOUS\n"
       << "0\nLAYER\n2\nOPENINGS\n70\n0\n62\n1\n6\nDASHED\n"
       << "0\nLAYER\n2\nDIMENSIONS\n70\n0\n62\n3\n6\nCONTINUOUS\n"
       << "0\nENDTAB\n"
       << "0\nENDSEC\n";

    // Entities section.
    os << "0\nSECTION\n2\nENTITIES\n";
}

void DxfWriter::write_footer(std::ostream& os) const {
    os << "0\nENDSEC\n0\nEOF\n";
}

// ---------------------------------------------------------------------------
// Per-wall output
// ---------------------------------------------------------------------------

void DxfWriter::write_wall(std::ostream& os, const Wall& wall,
                           double offset_x, int scale_denom) const {
    double scale = 1.0 / scale_denom;

    // Outer boundary.
    write_polyline(os, wall.outer, offset_x, 0.0, scale, "WALLS");

    // Openings.
    for (const auto& opening : wall.openings) {
        write_polyline(os, opening, offset_x, 0.0, scale, "OPENINGS");
    }

    // Dimension annotations: width and height.
    std::ostringstream w_label, h_label;
    w_label << std::fixed << std::setprecision(2) << wall.width << " m";
    h_label << std::fixed << std::setprecision(2) << wall.height << " m";

    double text_h = 0.15 * scale; // 15 cm text at model scale

    // Width label below the wall.
    write_dimension_text(os,
        (offset_x + wall.width * 0.5) * scale,
        -0.4 * scale,
        text_h, w_label.str(), "DIMENSIONS");

    // Height label to the right of the wall.
    write_dimension_text(os,
        (offset_x + wall.width + 0.3) * scale,
        wall.height * 0.5 * scale,
        text_h, h_label.str(), "DIMENSIONS");

    // Wall name label above.
    write_dimension_text(os,
        (offset_x + wall.width * 0.5) * scale,
        (wall.height + 0.3) * scale,
        text_h, wall.label, "DIMENSIONS");
}

void DxfWriter::write_polyline(std::ostream& os, const Loop2D& loop,
                                double ox, double oy,
                                double scale,
                                const std::string& layer) const {
    if (loop.vertices.empty()) return;

    os << "0\nLWPOLYLINE\n"
       << "8\n" << layer << "\n"
       << "90\n" << loop.vertices.size() << "\n"
       << "70\n1\n"; // closed polyline

    for (const auto& v : loop.vertices) {
        os << "10\n" << (v.x + ox) * scale << "\n"
           << "20\n" << (v.y + oy) * scale << "\n";
    }
}

void DxfWriter::write_dimension_text(std::ostream& os,
                                      double x, double y,
                                      double height,
                                      const std::string& text,
                                      const std::string& layer) const {
    os << "0\nTEXT\n"
       << "8\n" << layer << "\n"
       << "10\n" << x << "\n"
       << "20\n" << y << "\n"
       << "40\n" << height << "\n"
       << "1\n" << text << "\n"
       << "72\n1\n"    // center-aligned
       << "11\n" << x << "\n"
       << "21\n" << y << "\n";
}

} // namespace eficiencia
