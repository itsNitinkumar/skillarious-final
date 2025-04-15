import { Request, Response } from 'express';
import { db } from '../db';
import { 
  usersTable,
  adminLogsTable,
  coursesTable,
  modulesTable,
  contentTable,
  categoryCoursesTable,
  categoryTable,
  doubtsTable,
  educatorsTable,
  reviewsTable,
  transactionsTable
} from '../db/schema';
import { and, avg, desc, eq, sql, SQL,count } from 'drizzle-orm';
import { AdminActionInput } from '../schemas/admin';
import crypto from 'crypto';
import { sendEmail } from '../utils/email';
import bcrypt from 'bcrypt';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    isAdmin: boolean;
    role: string;
    isSuperAdmin: boolean;
  };
}

// Moderation Controllers
export const moderateUser = {
  banUser: async (req: AuthenticatedRequest & AdminActionInput, res: Response) => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      const targetUser = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .then(rows => rows[0]);

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (targetUser.isBanned) {
        return res.status(400).json({
          success: false,
          message: 'User is already banned'
        });
      }

      if (targetUser.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Cannot ban an admin user'
        });
      }

      const bannedUser = await db.transaction(async (tx) => {
        const updated = await tx
          .update(usersTable)
          .set({
            isBanned: true,
            banReason: reason,
            bannedAt: new Date()
          })
          .where(eq(usersTable.id, userId))
          .returning();

        await tx.insert(adminLogsTable).values({
          adminId: req.user.id,
          action: 'BAN_USER',
          targetId: userId,
          metadata: {
            reason,
            targetEmail: targetUser.email,
            targetName: targetUser.name
          }
        });

        return updated[0];
      });

      return res.status(200).json({
        success: true,
        message: 'User banned successfully',
        data: bannedUser
      });

    } catch (error) {
      console.error('Error in banUser:', error);
      return res.status(500).json({
        success: false,
        message: 'Error banning user'
      });
    }
  },

  unbanUser: async (req: AuthenticatedRequest & AdminActionInput, res: Response) => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }

      const targetUser = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .then(rows => rows[0]);

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!targetUser.isBanned) {
        return res.status(400).json({
          success: false,
          message: 'User is not banned'
        });
      }

      const unbannedUser = await db.transaction(async (tx) => {
        const updated = await tx
          .update(usersTable)
          .set({
            isBanned: false,
            banReason: null,
            bannedAt: null,
            // bannedBy: null
          })
          .where(eq(usersTable.id, userId))
          .returning();

        await tx.insert(adminLogsTable).values({
          adminId: req.user.id,
          action: 'UNBAN_USER',
          targetId: userId,
          metadata: {
            reason,
            previousBanReason: targetUser.banReason
          }
        });

        return updated[0];
      });

      return res.status(200).json({
        success: true,
        message: 'User unbanned successfully',
        data: unbannedUser
      });

    } catch (error) {
      console.error('Error in unbanUser:', error);
      return res.status(500).json({
        success: false,
        message: 'Error unbanning user'
      });
    }
  }
};

export const moderateCourse = {
  dismissCourse: async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      const { reason } = req.body;

      const dismissedCourse = await db
        .update(coursesTable)
        .set({ 
          isDismissed: true,
          dismissReason: reason,
          dismissedAt: new Date()
        })
        .where(eq(coursesTable.id, courseId))
        .returning();

      return res.status(200).json({
        success: true,
        message: 'Course dismissed successfully',
        data: dismissedCourse[0]
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Error dismissing course'
      });
    }
  }
};

export const moderateModule = {
  dismissModule: async (req: Request, res: Response) => {
    try {
      const { moduleId } = req.params;
      const { reason } = req.body;

      const dismissedModule = await db
        .update(modulesTable)
        .set({ 
          isDismissed: true,
          dismissReason: reason,
          dismissedAt: new Date()
        })
        .where(eq(modulesTable.id, moduleId))
        .returning();

      return res.status(200).json({
        success: true,
        message: 'Module dismissed successfully',
        data: dismissedModule[0]
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Error dismissing module'
      });
    }
  }
};

export const moderateContent = {
  dismissContent: async (req: Request, res: Response) => {
    try {
      const { contentId } = req.params;
      const { reason } = req.body;

      const dismissedContent = await db
        .update(contentTable)
        .set({ 
          isDismissed: true,
          dismissReason: reason,
          dismissedAt: new Date()
        })
        .where(eq(contentTable.id, contentId))
        .returning();

      return res.status(200).json({
        success: true,
        message: 'Content dismissed successfully',
        data: dismissedContent[0]
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Error dismissing content'
      });
    }
  }
};

// Analytics Controllers
export const getUserAnalytics = async (req: Request, res: Response) => {
  try {
    const analytics = await db
      .select({
        totalUsers: count(usersTable.id),
        activeUsers: sql<number>`COUNT(CASE WHEN last_login >= NOW() - INTERVAL '30 days' THEN 1 END)`,
        bannedUsers: sql<number>`COUNT(CASE WHEN is_banned = true THEN 1 END)`,
        newUsersThisMonth: sql<number>`COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END)`,
        verifiedUsers: sql<number>`COUNT(CASE WHEN verified = true THEN 1 END)`,
        educatorCount: sql<number>`COUNT(CASE WHEN is_educator = true THEN 1 END)`
      })
      .from(usersTable);

    return res.status(200).json({
      success: true,
      data: analytics[0]
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching user analytics'
    });
  }
};

export const getEngagementAnalytics = async (req: Request, res: Response) => {
  try {
    const analytics = await db
      .select({
        // Course Engagement
        totalEnrollments: sql<number>`COUNT(DISTINCT ${transactionsTable.courseId})`,
        averageCourseCompletion: sql<number>`AVG(completion_rate)`,
        
        // Content Engagement
        totalContentViews: sql<number>`SUM(view_count)`,
        averageTimeSpent: sql<number>`AVG(time_spent)`,
        
        // Interaction Metrics
        totalDoubts: sql<number>`COUNT(DISTINCT ${doubtsTable.id})`,
        resolvedDoubts: sql<number>`COUNT(CASE WHEN ${doubtsTable.resolved} = true THEN 1 END)`,
        averageResponseTime: sql<number>`AVG(response_time)`,
        
        // Review Metrics
        totalReviews: sql<number>`COUNT(DISTINCT ${reviewsTable.id})`,
        averageRating: avg(reviewsTable.rating),
        
        // Study Material Usage
        totalMaterialDownloads: sql<number>`SUM(download_count)`,
        uniqueStudentEngagement: sql<number>`COUNT(DISTINCT user_id)`
      })
      .from(coursesTable)
      .leftJoin(transactionsTable, eq(coursesTable.id, transactionsTable.courseId))
      .leftJoin(modulesTable, eq(coursesTable.id, modulesTable.courseId))
      .leftJoin(contentTable, eq(modulesTable.id, contentTable.moduleId))
      .leftJoin(doubtsTable, eq(contentTable.id, doubtsTable.contentId))
      .leftJoin(reviewsTable, eq(coursesTable.id, reviewsTable.courseId));

    return res.status(200).json({
      success: true,
      data: analytics[0]
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching engagement analytics'
    });
  }
};

export const getRevenueAnalytics = async (req: Request, res: Response) => {
  try {
    const analytics = await db
      .select({
        totalRevenue: sql<number>`SUM(${transactionsTable.amount})`,
        monthlyRevenue: sql<number>`SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN amount END)`,
        averageTransactionValue: avg(transactionsTable.amount),
        successfulTransactions: sql<number>`COUNT(CASE WHEN status = 'completed' THEN 1 END)`,
        failedTransactions: sql<number>`COUNT(CASE WHEN status = 'failed' THEN 1 END)`,
        topPerformingCourses: sql`
          SELECT 
            c.name,
            COUNT(t.id) as sales,
            SUM(t.amount) as revenue
          FROM courses c
          JOIN transactions t ON c.id = t.course_id
          GROUP BY c.id, c.name
          ORDER BY revenue DESC
          LIMIT 5
        `
      })
      .from(transactionsTable);

    return res.status(200).json({
      success: true,
      data: analytics[0]
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching revenue analytics'
    });
  }
};

// Platform Overview Analytics
export const getPlatformOverview = async (req: Request, res: Response) => {
  try {
    const overview = await db
      .select({
        // User Metrics
        totalUsers: sql<number>`COUNT(DISTINCT ${usersTable.id})`,
        totalEducators: sql<number>`COUNT(DISTINCT ${educatorsTable.id})`,
        verifiedUsers: sql<number>`COUNT(CASE WHEN ${usersTable.verified} = true THEN 1 END)`,
        
        // Course Metrics
        totalCourses: sql<number>`COUNT(DISTINCT ${coursesTable.id})`,
        activeCourses: sql<number>`COUNT(DISTINCT CASE WHEN ${coursesTable.end} >= NOW() THEN ${coursesTable.id} END)`,
        totalCategories: sql<number>`COUNT(DISTINCT ${categoryTable.id})`,
        totalModules: sql<number>`COUNT(DISTINCT ${modulesTable.id})`,
        
        // Content Metrics
        totalContent: sql<number>`COUNT(DISTINCT ${contentTable.id})`,
        
        // Financial Metrics
        totalRevenue: sql<number>`SUM(${transactionsTable.amount})`,
        successfulTransactions: sql<number>`COUNT(CASE WHEN ${transactionsTable.status} = 'completed' THEN 1 END)`,
        
        // Review Metrics
        totalReviews: sql<number>`COUNT(DISTINCT ${reviewsTable.id})`,
        averageRating: sql<number>`AVG(${reviewsTable.rating})`,
        
        // Support Metrics
        totalDoubts: sql<number>`COUNT(DISTINCT ${doubtsTable.id})`,
        resolvedDoubts: sql<number>`COUNT(CASE WHEN ${doubtsTable.resolved} = true THEN 1 END)`,
      })
      .from(usersTable)
      .leftJoin(educatorsTable, eq(usersTable.id, educatorsTable.userId))
      .leftJoin(coursesTable, eq(educatorsTable.id, coursesTable.educatorId))
      .leftJoin(transactionsTable, eq(coursesTable.id, transactionsTable.courseId))
      .leftJoin(reviewsTable, eq(coursesTable.id, reviewsTable.courseId))
      .leftJoin(doubtsTable, eq(usersTable.id, doubtsTable.userId));

    return res.status(200).json({
      success: true,
      data: overview[0]
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching platform overview'
    });
  }
};

// Review Analytics
export const getReviewAnalytics = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, courseId, educatorId } = req.query;
    
    let conditions: SQL[] = [];
    
    if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        conditions.push(
          sql`${reviewsTable.createdAt} BETWEEN ${start}::timestamp AND ${end}::timestamp`
        );
      }
    }
    if (courseId) {
      conditions.push(eq(reviewsTable.courseId, courseId as string));
    }
    if (educatorId) {
      conditions.push(eq(reviewsTable.educatorId, educatorId as string));
    }

    let query = db
      .select({
        totalReviews: count(reviewsTable.id),
        averageRating: avg(reviewsTable.rating),
        
        // Rating Distribution
        fiveStarCount: sql<number>`COUNT(CASE WHEN ${reviewsTable.rating} = 5 THEN 1 END)`,
        fourStarCount: sql<number>`COUNT(CASE WHEN ${reviewsTable.rating} = 4 THEN 1 END)`,
        threeStarCount: sql<number>`COUNT(CASE WHEN ${reviewsTable.rating} = 3 THEN 1 END)`,
        twoStarCount: sql<number>`COUNT(CASE WHEN ${reviewsTable.rating} = 2 THEN 1 END)`,
        oneStarCount: sql<number>`COUNT(CASE WHEN ${reviewsTable.rating} = 1 THEN 1 END)`,
        
        courseId: coursesTable.id,
        courseName: coursesTable.name,
        educatorId: educatorsTable.id,
        educatorName: usersTable.name,
      })
      .from(reviewsTable)
      .leftJoin(coursesTable, eq(reviewsTable.courseId, coursesTable.id))
      .leftJoin(educatorsTable, eq(reviewsTable.educatorId, educatorsTable.id))
      .leftJoin(usersTable, eq(educatorsTable.userId, usersTable.id))
      .where(conditions.length ? and(...conditions) : undefined);

    const reviewStats = await query;

    // Get top reviewed courses
    const topCourses = await db
      .select({
        courseId: coursesTable.id,
        courseName: coursesTable.name,
        totalReviews: count(reviewsTable.id),
        averageRating: avg(reviewsTable.rating),
        educatorName: usersTable.name
      })
      .from(coursesTable)
      .leftJoin(reviewsTable, eq(coursesTable.id, reviewsTable.courseId))
      .leftJoin(educatorsTable, eq(coursesTable.educatorId, educatorsTable.id))
      .leftJoin(usersTable, eq(educatorsTable.userId, usersTable.id))
      .groupBy(coursesTable.id, coursesTable.name, usersTable.name)
      .orderBy(desc(avg(reviewsTable.rating)))
      .limit(10);

    return res.status(200).json({
      success: true,
      data: {
        overview: reviewStats[0],
        topCourses
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching review analytics'
    });
  }
};

// Course Category Analytics
export const getCategoryAnalytics = async (req: Request, res: Response) => {
  try {
    const categoryStats = await db
      .select({
        categoryId: categoryTable.id,
        categoryName: categoryTable.name,
        courseCount: sql<number>`COUNT(DISTINCT ${categoryCoursesTable.courseId})`,
        totalRevenue: sql<number>`SUM(${transactionsTable.amount})`,
        averageRating: avg(reviewsTable.rating)
      })
      .from(categoryTable)
      .leftJoin(categoryCoursesTable, eq(categoryTable.id, categoryCoursesTable.categoryId))
      .leftJoin(coursesTable, eq(categoryCoursesTable.courseId, coursesTable.id))
      .leftJoin(transactionsTable, eq(coursesTable.id, transactionsTable.courseId))
      .leftJoin(reviewsTable, eq(coursesTable.id, reviewsTable.courseId))
      .groupBy(categoryTable.id, categoryTable.name)
      .orderBy(desc(sql<number>`COUNT(DISTINCT ${categoryCoursesTable.courseId})`));

    return res.status(200).json({
      success: true,
      data: categoryStats
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching category analytics'
    });
  }
};

// Educator Analytics
export const getEducatorAnalytics = async (req: Request, res: Response) => {
  try {
    const educatorStats = await db
      .select({
        educatorId: educatorsTable.id,
        educatorName: usersTable.name,
        courseCount: sql<number>`COUNT(DISTINCT ${coursesTable.id})`,
        totalStudents: sql<number>`COUNT(DISTINCT ${transactionsTable.userId})`,
        totalRevenue: sql<number>`SUM(${transactionsTable.amount})`,
        averageRating: avg(reviewsTable.rating),
        totalDoubts: sql<number>`COUNT(DISTINCT ${doubtsTable.id})`,
        resolvedDoubts: sql<number>`COUNT(CASE WHEN ${doubtsTable.resolved} = true THEN 1 END)`
      })
      .from(educatorsTable)
      .leftJoin(usersTable, eq(educatorsTable.userId, usersTable.id))
      .leftJoin(coursesTable, eq(educatorsTable.id, coursesTable.educatorId))
      .leftJoin(transactionsTable, eq(coursesTable.id, transactionsTable.courseId))
      .leftJoin(reviewsTable, eq(coursesTable.id, reviewsTable.courseId))
      .leftJoin(doubtsTable, eq(educatorsTable.id, doubtsTable.educatorAssigned))
      .groupBy(educatorsTable.id, usersTable.name)
      .orderBy(desc(sql<number>`COUNT(DISTINCT ${coursesTable.id})`));

    return res.status(200).json({
      success: true,
      data: educatorStats
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching educator analytics'
    });
  }
};

export const inviteAdmin = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invitingAdmin = req.user;
    const { email } = req.body;

    // Check if inviting user is super admin
    if (!invitingAdmin.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only super admins can invite new admins'
      });
    }

    // Generate invite token
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

    // Create invite record
    await db.insert(adminInvitesTable).values({
      email,
      inviteToken,
      expiresAt,
      createdBy: invitingAdmin.id
    });

    // Send invitation email
    const inviteUrl = `${process.env.FRONTEND_URL}/admin/register?token=${inviteToken}`;
    await sendEmail({
      to: email,
      subject: 'Admin Invitation',
      text: `You've been invited to become an admin. Register here: ${inviteUrl}`
    });

    return res.status(200).json({
      success: true,
      message: 'Admin invitation sent successfully'
    });
  } catch (error) {
    console.error('Error in inviteAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send admin invitation'
    });
  }
};

export const registerAdmin = async (req: Request, res: Response) => {
  try {
    const { name, email, password, inviteToken } = req.body;

    // Validate invite token
    const invite = await db.select()
      .from(adminInvitesTable)
      .where(and(
        eq(adminInvitesTable.inviteToken, inviteToken),
        eq(adminInvitesTable.email, email),
        eq(adminInvitesTable.used, false),
        gt(adminInvitesTable.expiresAt, new Date())
      ))
      .limit(1);

    if (!invite.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired invitation'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user
    const [newAdmin] = await db.insert(usersTable)
      .values({
        name,
        email,
        password: hashedPassword,
        isAdmin: true,
        role: 'admin',
        verified: true
      })
      .returning();

    // Mark invite as used
    await db.update(adminInvitesTable)
      .set({ used: true })
      .where(eq(adminInvitesTable.inviteToken, inviteToken));

    // Log admin creation
    await db.insert(adminLogsTable).values({
      adminId: invite[0].createdBy,
      action: 'CREATE_ADMIN',
      targetId: newAdmin.id,
      metadata: { email: newAdmin.email }
    });

    return res.status(201).json({
      success: true,
      message: 'Admin registered successfully'
    });
  } catch (error) {
    console.error('Error in registerAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to register admin'
    });
  }
};


