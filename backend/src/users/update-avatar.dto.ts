import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateAvatarDto {
  @IsString()
  @IsNotEmpty()
  avatarUrl: string;
}
