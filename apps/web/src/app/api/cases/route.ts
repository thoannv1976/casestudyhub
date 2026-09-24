import { NextResponse, type NextRequest } from 'next/server';
import { createCaseSchema } from '@casestudyhub/shared';
import { createCase, filterCasesForStudent, listCases } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Students see published cases only; staff see drafts as well. */
export async function GET() {
  try {
    const caller = await requireSessionUser();
    const all = await listCases({ publishedOnly: caller.role === 'student' });

    // Publishing a case for one course must not hand it to the whole
    // university: a student sees the courses they are actually taking.
    const cases = caller.role === 'student' ? await filterCasesForStudent(caller.uid, all) : all;

    return NextResponse.json({ cases });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission('case.upload');
    const input = createCaseSchema.parse(await request.json());
    const caseId = await createCase(actor, input);
    return NextResponse.json({ caseId }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}
