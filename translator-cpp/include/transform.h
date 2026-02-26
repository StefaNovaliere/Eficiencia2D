#pragma once

#include "vec3.h"
#include <array>
#include <SketchUpAPI/geometry.h>

namespace eficiencia {

/// 4x4 affine transformation matrix (column-major, matching SketchUp convention).
class Transform {
public:
    // Identity by default
    Transform() {
        m_.fill(0.0);
        m_[0] = m_[5] = m_[10] = m_[15] = 1.0;
    }

    /// Construct from SketchUp SUTransformation (column-major double[16]).
    explicit Transform(const SUTransformation& su) {
        for (int i = 0; i < 16; ++i)
            m_[i] = su.values[i];
    }

    /// Apply this transform to a point.
    Vec3 apply(const Vec3& p) const {
        double w = m_[3] * p.x + m_[7] * p.y + m_[11] * p.z + m_[15];
        if (std::abs(w) < 1e-15) w = 1.0;
        return {
            (m_[0] * p.x + m_[4] * p.y + m_[8]  * p.z + m_[12]) / w,
            (m_[1] * p.x + m_[5] * p.y + m_[9]  * p.z + m_[13]) / w,
            (m_[2] * p.x + m_[6] * p.y + m_[10] * p.z + m_[14]) / w
        };
    }

    /// Apply this transform to a direction (ignoring translation).
    Vec3 apply_direction(const Vec3& d) const {
        return Vec3{
            m_[0] * d.x + m_[4] * d.y + m_[8]  * d.z,
            m_[1] * d.x + m_[5] * d.y + m_[9]  * d.z,
            m_[2] * d.x + m_[6] * d.y + m_[10] * d.z
        }.normalized();
    }

    /// Compose: this * other  (apply other first, then this).
    Transform operator*(const Transform& other) const {
        Transform result;
        result.m_.fill(0.0);
        for (int col = 0; col < 4; ++col)
            for (int row = 0; row < 4; ++row)
                for (int k = 0; k < 4; ++k)
                    result.m_[col * 4 + row] += m_[k * 4 + row] * other.m_[col * 4 + k];
        return result;
    }

private:
    std::array<double, 16> m_;
};

} // namespace eficiencia
