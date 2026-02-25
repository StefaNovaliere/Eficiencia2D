#pragma once

#include "wall.h"
#include <string>
#include <vector>

namespace eficiencia {

/// Writes a set of walls to a DXF file with dimension annotations.
class DxfWriter {
public:
    /// scale_denom: e.g. 100 for 1:100.  All coordinates are divided by this.
    void write(const std::vector<Wall>& walls,
               const std::string& output_path,
               int scale_denom = 100) const;

private:
    void write_header(std::ostream& os) const;
    void write_footer(std::ostream& os) const;
    void write_wall(std::ostream& os, const Wall& wall,
                    double offset_x, int scale_denom) const;
    void write_polyline(std::ostream& os, const Loop2D& loop,
                        double ox, double oy,
                        double scale, const std::string& layer) const;
    void write_dimension_text(std::ostream& os,
                              double x, double y,
                              double height,
                              const std::string& text,
                              const std::string& layer) const;
};

} // namespace eficiencia
