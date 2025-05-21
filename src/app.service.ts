import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { parseICS } from 'node-ical';
import * as path from 'path';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as dayjs from 'dayjs';

const TIMEZONE = 'Asia/Seoul';

type SlackPostMessageResponse = {
  ok: boolean;
  error?: string;
  warning?: string;
  response_metadata?: {
    messages?: string[];
    warnings?: string[];
  };
  ts?: string;
};

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.getHolidayByGoogleCalendar();
  }

  getHello(): string {
    return 'Hello World!';
  }

  /**
   * 매월 초 연휴 캘린더 갱신
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT, {
    timeZone: TIMEZONE,
  })
  async getHolidayByGoogleCalendar() {
    console.log('매월 초 연휴 캘린더 갱신 시작');

    const year = dayjs().tz().year();

    const GOOGLE_CALENDAR_HOLIDAY_URI = this.configService.get<string>(
      'GOOGLE_CALENDAR_HOLIDAY_URI',
    );

    if (!GOOGLE_CALENDAR_HOLIDAY_URI)
      throw new BadRequestException('구글 캘린더 공휴일 주소가 없어요');

    const dir = path.resolve(process.cwd(), 'holidays');
    const res = await fetch(GOOGLE_CALENDAR_HOLIDAY_URI);
    const icsData = await res.text();

    const events = parseICS(icsData);

    const holidays: string[] = [];

    for (const key in events) {
      const event = events[key];

      if (event.type === 'VEVENT') {
        const localStartDate = dayjs(event.start).tz();
        const date = localStartDate.format('YYYY-MM-DD');

        const y = parseInt(date.slice(0, 4), 10);
        if (y === year) holidays.push(date);
      }
    }

    holidays.sort();

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`디렉토리 ${dir} 생성 완료`);
    }

    const filePath = path.join(dir, `holidays-${year}.json`);
    writeFileSync(filePath, JSON.stringify(holidays, null, 2));

    console.log(`${year}년 공휴일 데이터를 덮어썼습니다.`);
  }

  /**
   * 공휴일 유무 확인
   * @returns
   */
  private shouldSkipToday() {
    const todayKST = dayjs().tz().format('YYYY-MM-DD');
    const year = dayjs().tz().year();

    const filePath = path.resolve(
      process.cwd(),
      'holidays',
      `holidays-${year}.json`,
    );

    if (!existsSync(filePath)) {
      console.warn(
        '공휴일 데이터 파일이 없습니다. 출퇴근 로직을 계속 진행합니다.',
      );
      return false;
    }

    const holidays = JSON.parse(readFileSync(filePath, 'utf-8')) as string[];

    if (holidays.includes(todayKST)) {
      console.log('오늘은 공휴일입니다. 출퇴근하지 않습니다.');
    }

    return holidays.includes(todayKST);
  }

  /**
   * 랜덤 딜레이
   * @param minMinutes
   * @param maxMinutes
   * @returns
   */
  private getRandomDelay(minMinutes: number, maxMinutes: number): number {
    const min = minMinutes * 60 * 1000;
    const max = maxMinutes * 60 * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private async processCommute(type: '출근' | '퇴근') {
    const isHoliday = this.shouldSkipToday();

    if (isHoliday) return;

    const delay = this.getRandomDelay(0, 14);
    console.log(`랜덤 지연 ${delay / 1000}초 후 ${type} 버튼 클릭`);

    await new Promise((resolve) => setTimeout(resolve, delay));

    await this.performCommuteAction(type);
  }

  private async sendSlackNotification(message: string) {
    const SLACK_POST_MESSAGE_URI = this.configService.get<string>(
      'SLACK_POST_MESSAGE_URI',
    ) as string;
    const SLACK_BOT_TOKEN = this.configService.get<string>(
      'SLACK_BOT_TOKEN',
    ) as string;

    const SLACK_USER_ID = this.configService.get<string>(
      'SLACK_USER_ID',
    ) as string;

    const res = await fetch(SLACK_POST_MESSAGE_URI, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: SLACK_USER_ID,
        text: message,
      }),
    });

    const result = (await res.json()) as SlackPostMessageResponse;

    if (!result.ok) {
      console.error('Slack 전송 실패:', message, result.error);
    } else {
      console.log('Slack 전송 성공:', message, result.ts);
    }
  }

  async performCommuteAction(type: '출근' | '퇴근') {
    const now = dayjs().tz();
    const hour = now.hour();
    const minutes = now.minute();

    const isMorning = hour === 9 && minutes >= 45 && minutes <= 59;
    const isEvening = hour === 19 && minutes <= 20;

    console.log(
      `현재 시간: ${hour}:${minutes}, 출근여부: ${isMorning}, 퇴근여부: ${isEvening}`,
    );

    if ((type === '출근' && !isMorning) || (type === '퇴근' && !isEvening)) {
      console.log('지정된 시간대가 아닙니다.');
      return;
    }

    const browser = await chromium.launch({ headless: true, slowMo: 200 });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    console.log('브라우저 실행 후 페이지 로드 시작');

    const HIWORKS_LOGIN_PAGE_URI = this.configService.get<string>(
      'HIWORKS_LOGIN_PAGE_URI',
    ) as string;
    const HIWORKS_LOGIN_EMAIL = this.configService.get<string>(
      'HIWORKS_LOGIN_EMAIL',
    ) as string;
    const HIWORKS_LOGIN_PASSWORD = this.configService.get<string>(
      'HIWORKS_LOGIN_PASSWORD',
    ) as string;
    const HIWORKS_PERSONAL_PAGE_URI = this.configService.get<string>(
      'HIWORKS_PERSONAL_PAGE_URI',
    ) as string;
    const HIWORKS_MAIN_PAGE_URI = this.configService.get<string>(
      'HIWORKS_MAIN_PAGE_URI',
    ) as string;

    try {
      if (!HIWORKS_LOGIN_PAGE_URI)
        throw new BadRequestException('하이웍스 로그인 URL을 찾을 수 없어요');

      console.log('🔍 페이지 접속 시도 중...');

      await page.goto(HIWORKS_LOGIN_PAGE_URI, {
        waitUntil: 'load',
        timeout: 30000,
      });

      console.log('🔍 페이지 접속 시도 중...');

      await page.waitForSelector('input[placeholder="로그인 ID"]');
      await page.getByPlaceholder('로그인 ID').fill(HIWORKS_LOGIN_EMAIL);

      console.log('➡️ 다음 버튼 클릭 중...');

      await page.getByRole('button', { name: '다음' }).click();

      await page.waitForSelector('input[placeholder="비밀번호"]');
      await page.getByPlaceholder('비밀번호').fill(HIWORKS_LOGIN_PASSWORD);

      await page.locator('button[type="submit"]:has-text("로그인")').click();

      await page.waitForURL(HIWORKS_MAIN_PAGE_URI, { timeout: 10000 });

      await page.goto(HIWORKS_PERSONAL_PAGE_URI);

      console.log('근태 페이지 접속 완료');

      await page.waitForSelector('ul.division-list button');

      const buttons = await page.locator('ul.division-list button').all();

      page.on('dialog', async (dialog) => {
        console.log('알럿 메시지:', dialog.message());
        await dialog.accept();
      });

      for (const btn of buttons) {
        const text = await btn.innerText();

        if (
          isMorning &&
          text.includes('출근하기') &&
          !(await btn.isDisabled())
        ) {
          await btn.click();
          console.log(
            `[${dayjs().tz().format('YYYY-MM-DD HH:mm:ss')}] 출근 체크`,
          );
          await this.sendSlackNotification('✅ 출근 버튼이 클릭되었습니다.');

          break;
        }
        if (
          isEvening &&
          text.includes('퇴근하기') &&
          !(await btn.isDisabled())
        ) {
          await btn.click();
          console.log(
            `[${dayjs().tz().format('YYYY-MM-DD HH:mm:ss')}] 퇴근 체크`,
          );
          await this.sendSlackNotification('✅ 퇴근 버튼이 클릭되었습니다.');

          break;
        }
      }
    } catch (error) {
      console.error('❌ 오류 발생:', error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);

      await this.sendSlackNotification(
        `❌ 출퇴근 자동화 실패: ${errorMessage}`,
      );
    } finally {
      if (browser) {
        await browser.close();
        console.log('브라우저 종료');
      }
    }
  }

  /**
   * 출근 자동화 (매주 월~금 9시 45분에 실행)
   */
  @Cron('45 9 * * 1-5', { timeZone: TIMEZONE })
  async morningCommute() {
    await this.processCommute('출근');
  }

  /**
   * 퇴근 자동화 (매주 월~금 7시 0분에 실행)
   */
  @Cron('0 19 * * 1-5', { timeZone: TIMEZONE })
  async eveningCommute() {
    await this.processCommute('퇴근');
  }
}
