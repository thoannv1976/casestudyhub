import { NextResponse, type NextRequest } from 'next/server';
import {
  createAcademicYearSchema,
  createCourseSchema,
  createSemesterSchema,
} from '@casestudyhub/shared';
import { createAcademicYear, createCourse, createSemester, AppError } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Creates one level of the academic structure. The `kind` in the body says
 * which, so the three small forms of the admin page share one endpoint.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission('course.create');
    const body = await request.json();

    switch (body?.kind) {
      case 'academicYear': {
        const id = await createAcademicYear(actor, createAcademicYearSchema.parse(body));
        return NextResponse.json({ id }, { status: 201 });
      }
      case 'semester': {
        const id = await createSemester(actor, createSemesterSchema.parse(body));
        return NextResponse.json({ id }, { status: 201 });
      }
      case 'course': {
        const id = await createCourse(actor, createCourseSchema.parse(body));
        return NextResponse.json({ id }, { status: 201 });
      }
      default:
        throw new AppError('VALIDATION_FAILED', 'errors.unknownKind');
    }
  } catch (error) {
    return respondWithError(error);
  }
}
